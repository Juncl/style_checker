# iframe 接入逻辑

## 概述

本工具的 consistency 页（`/#/consistency`）支持被**外部父页面以 iframe 方式嵌入**。父页面（内网真实环境为某宿主系统，外网开发环境为测试页 `/#/testIframe`）在 iframe 加载后，通过 `postMessage` 向子页面**下发一批待检测的开发侧数据（checkList）**；子页面收到后，自动为这批数据**创建交付件 + 多个页面**，并展示最后一个页面的结果。

整条链路分四段：

1. **消息协议层**（`Messenger`）：封装父子窗口的 `postMessage` 收发
2. **检测与监听层**（`detectIframe`）：子页面检测自身处于 iframe 中，发就绪信号 + 监听父页面消息，把合法消息翻译成应用内事件
3. **业务处理层**（`processUxlintCheckList`）：拿到 checkList 后调后台接口建交付件/页面
4. **渲染层**（`ConsistencyView` + `loadHistoryVersion`）：更新组件状态、渲染报告页（开发侧有数据则画布、设计侧为空则卡片）

> ⚠️ 父页面侧（`TestIframeView.vue`）和 mock 数据路由仅为**外网测试**用，内网环境由真实宿主系统下发消息，不依赖这两者。

---

## 角色分工

| 层 | 文件 | 职责 |
|---|---|---|
| 消息协议 | `client/src/views/utils/message.ts` | `Messenger`：`sendToParent` / `sendToChild` / `listen` |
| 检测+监听 | `client/src/views/consistency/init/detectIframe.ts` | 检测 iframe、发就绪信号、监听消息、校验后派发 CustomEvent |
| 初始化编排 | `client/src/views/consistency/init/index.ts` | `initApp` 中调用 `detectIframe()`，返回卸载函数 |
| 业务处理 | `client/src/views/consistency/init/processUxlintCheckList.ts` | 建交付件、串行建页面、返回最后一个版本 |
| 渲染 | `client/src/views/consistency/ConsistencyView.vue` | `onUxlintCheckList` 响应事件 → 复用 `loadHistoryVersion` 渲染 |
| 测试父页面 | `client/src/views/testIframe/TestIframeView.vue` | 仅测试用：内嵌 consistency，加载后下发模拟 checkList |
| 测试数据 | `mock/routes/uxlintTest.js` | 仅测试用：提供 `case/hmPhone/` 的 arkui.json / arkui.png |

---

## 一、消息协议层（Messenger）

**文件**：`client/src/views/utils/message.ts`

三个方法：

| 方法 | 方向 | 发出的报文结构 |
|---|---|---|
| `sendToChild(iframeEl, type, content)` | 父 → 子 | `{ source: 'from-parent', type, content }` |
| `sendToParent(type, data, targetOrigin='*')` | 子 → 父 | `{ type, data }` |
| `listen(callback, expectedOrigin=null)` | 收 | 触发 `callback(event.data.type, event.data, event)`，返回卸载函数 |

`listen` 内部对 `event.data.type` 存在才回调；返回的卸载函数用于 `removeEventListener`。

---

## 二、检测与监听层（detectIframe）

**文件**：`client/src/views/consistency/init/detectIframe.ts`

在 `initApp` 中被调用（`index.ts`），执行流程：

1. 检测 `window.self !== window.top` 判断是否在 iframe 中；不在则直接返回 `null`
2. 在 iframe 中：
   - `Messenger.sendToParent('LOAD_SUCCESS', { id: 1, status: 'success' })` 告知父页面"子页面就绪"
   - `Messenger.listen(...)` 监听父页面消息
3. 监听回调里只处理 `type === 'uxlint'` 的消息，并**校验 checkList 格式**：
   ```js
   content?.type === 'checkList' && Array.isArray(content?.list) && content.list.length > 0
   ```
4. 校验通过 → **派发应用内 CustomEvent**（不直接处理业务）：
   ```js
   window.dispatchEvent(new CustomEvent(UXLINT_CHECKLIST_EVENT, { detail: content.list }))
   ```

> **设计要点**：`detectIframe` 只负责"把 iframe 消息翻译成应用内事件"，不碰业务、不更新组件状态。事件名常量 `UXLINT_CHECKLIST_EVENT = 'uxlint:checkList'` 由本文件导出，`ConsistencyView` 引用同一常量，避免硬编码字符串两处不一致。

`detectIframe()` 返回 `Messenger.listen` 的卸载函数（或 `null`），经 `initApp` 透出给 `ConsistencyView`，在 `onUnmounted` 中调用以解除 postMessage 监听。

### 为什么用 CustomEvent 而不是回调透传

checkList 消息是**异步到达**的（时机与 `initApp` 生命周期无关），不能像 `loadDeliverable` 那样用返回值传出。用 `window` 上的 CustomEvent 解耦后：`detectIframe` / `initApp` / `index.ts` 都不需要知道 checkList 怎么处理，`ConsistencyView` 只管监听事件改自己的状态，职责干净。唯一代价是引入一个全局事件名约定。

---

## 三、消息格式（checkList）

父页面下发的完整报文（经 `sendToChild` 包装）：

```js
{
  source: 'from-parent',
  type: 'uxlint',
  content: {
    type: 'checkList',
    list: [
      { arkFileUrl: '...', id: 152, imageUrl: '...', name: '20260615_12.00.09' },
      { arkFileUrl: '...', id: 98,  imageUrl: '...', name: '20260615_12.00.10' }
    ]
  }
}
```

`list` 中每一项 = 一个待检测页面（**仅开发侧**，无设计侧）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `arkFileUrl` | string | 开发侧 arkui.json 的远程地址 |
| `imageUrl` | string | 开发侧截图的远程地址 |
| `id` | number | 业务侧标识（当前流程未直接使用） |
| `name` | string | 作为页面名称 |

---

## 四、业务处理层（processUxlintCheckList）

**文件**：`client/src/views/consistency/init/processUxlintCheckList.ts`

入参 `list`，**串行**处理，全程不调用算法侧对比接口（模拟空结果）：

1. `getTeamList()` → `teamId`
2. `getSonListByTeamId(teamId)` → `subTeamId`
3. `addConsistencyCheckDeliverable(subTeamId, now)` → `deliverableId`（`now` 为 `formatDateTime(new Date())`，即交付件名）
4. **串行遍历 list**，每项：
   - `fetchText(arkFileUrl)` 拿开发侧 JSON 文本
   - `fetchBase64(imageUrl)` 拿开发侧截图并转 base64
   - `addConsistencyCheckPage({ ... designJson: '', designImageBase64Data: '', problems: [], nodeMatchs: [] })` 建页面（设计侧入参传**空字符串**、对比项为空；接口回读该版本时设计侧字段为 `null`）
   - `getResultsByPageId(pageId)` 取该页面最新版本，记为 `lastVersion`
5. 返回 `{ deliverableId, deliverableList, pageList, lastPage, lastVersion }`

### 域名替换

`arkFileUrl` / `imageUrl` 是父页面环境的远程域名，子页面无法直接访问。`fetch` 前用 `replaceOrigin` 把域名换成**当前页面域名**，再经 Vite proxy（外网）或同源（内网）取数据：

```js
function replaceOrigin(url) {
  return url.replace(/^https?:\/\/[^/]+/, window.location.origin)
}
```

例：`https://fake-internal.com/mock/uxlint-test/case1/arkui.json` → `http://localhost:5173/mock/uxlint-test/case1/arkui.json` → Vite proxy → mock(3001)。

---

## 五、渲染层（ConsistencyView）

**文件**：`client/src/views/consistency/ConsistencyView.vue`

### 事件注册与卸载

- `onMounted` 中 `window.addEventListener(UXLINT_CHECKLIST_EVENT, onUxlintCheckList)`
- `cleanup`（`onUnmounted`）中 `window.removeEventListener(...)` + 调用 `detectIframe` 返回的 `stopListenFn`

### onUxlintCheckList

```js
async function onUxlintCheckList(e) {
  const list = e.detail
  loading.value = true
  try {
    const checkResult = await processUxlintCheckList(list)
    deliverables.value       = checkResult.deliverableList
    workingDeliverable.value = checkResult.deliverableList.find(d => String(d.id) === checkResult.deliverableId) ?? null
    pages.value              = checkResult.pageList
    workingPage.value        = checkResult.lastPage
    workingVersionId.value   = checkResult.lastVersion?.id ? String(checkResult.lastVersion.id) : null
    // 复用历史版本渲染：开发侧有数据 → 画布；设计侧为空 → 卡片
    if (checkResult.lastVersion) {
      await loadHistoryVersion(checkResult.lastVersion, 'hmPhone')
    }
  } catch (err) {
    console.error('[uxlint] 处理失败', err)
    ElMessage.error('uxlint 数据处理失败，请检查控制台')
  } finally {
    loading.value = false
  }
}
```

设置完列表状态后，**复用 `loadHistoryVersion`** 渲染最后一个版本——iframe 场景与普通历史加载共用同一套渲染与空容忍逻辑，规则只维护一处。

### loadHistoryVersion 的"某侧为空 → 卡片"逻辑

这是**通用能力**，不限于 iframe：被动渲染报告页时，若某侧数据为空，该侧停在上传卡片状态而非报告画布。

- **空判断**：以图片 base64 是否为空为准 —— `devEmpty = !version.devBase64Data`、`designEmpty = !version.designBase64Data`
  - 因为 mock 把空 JSON 存成 `{}`、空图片存成 `''`，`designJsonUrl` 永远有值，唯一可靠的空信号是图片 base64
- **只解析非空侧**：空侧跳过 fetch/parse，避免解析占位 `{}` 产生垃圾节点
- **空侧 → 卡片**：`xxxReuploading.value = true` + `uploadFiles` 该侧置 `null` → ReportPage 走 `DevUploadCard` / `DesignUploadCard` 分支，不读 `result.canvas.该侧`
- **canvas**：空侧借非空侧尺寸占位（反正不被读）
- **pairs / diffs**：任一侧为空时清空（缺一侧无从配对比对）

> **边界**：以上"容忍空"仅作用于**被动渲染报告页**。**主动上传页的"开始对比"按钮校验**（`UploadPanel.vue` 的 `canStartCheck`，要求 designJson/arkuiJson/designImage/arkuiImage 四件齐全）**不受影响**，主动上传仍要求两侧齐全。

---

## 六、测试父页面与 mock 数据（仅外网测试）

### TestIframeView.vue

**文件**：`client/src/views/testIframe/TestIframeView.vue`，路由 `/#/testIframe`（`router/index.ts` 注册）。

- 布局：上栏 48px（显示 iframe 加载状态）、左栏 48px（预留）、右下区域内嵌 `/#/consistency`
- iframe `@load` 后，用 `Messenger.sendToChild` 自动下发一条模拟 checkList（指向 mock 的两个 case）

### mock 数据路由

**文件**：`mock/routes/uxlintTest.js`，在 `mock/routes/index.js` 注册为 `/mock/uxlint-test`。

| 接口 | 返回 |
|---|---|
| `GET /mock/uxlint-test/:caseId/arkui.json` | `case/hmPhone/:caseId/arkui.json` |
| `GET /mock/uxlint-test/:caseId/arkui.png` | `case/hmPhone/:caseId/arkui.png` |

模拟 checkList 里的 `arkFileUrl` / `imageUrl` 即指向上述路径（带占位域名，经 `replaceOrigin` 转回本地）。

---

## 数据流全链路

```
父页面 iframe @load
  ↓ Messenger.sendToChild(iframe, 'uxlint', { type:'checkList', list:[...] })
postMessage  →  子页面
  ↓ Messenger.listen 回调（detectIframe.ts）
校验 content.type==='checkList' && list 非空
  ↓ window.dispatchEvent(CustomEvent('uxlint:checkList', { detail: list }))
ConsistencyView.onUxlintCheckList(e)        [监听 UXLINT_CHECKLIST_EVENT]
  ↓ e.detail = list
processUxlintCheckList(list)                [init/processUxlintCheckList.ts]
  ├─ getTeamList → getSonListByTeamId
  ├─ addConsistencyCheckDeliverable → deliverableId
  └─ 串行遍历 list：
       fetchText(arkFileUrl) + fetchBase64(imageUrl)   [replaceOrigin 换域名]
       → addConsistencyCheckPage（设计侧 null、对比项空）
       → getResultsByPageId → lastVersion
  ↓ { deliverableList, pageList, lastPage, lastVersion }
更新 deliverables/pages/workingDeliverable/workingPage/workingVersionId
  ↓
loadHistoryVersion(lastVersion, 'hmPhone')  [复用历史渲染 + 空容忍]
  ├─ 开发侧有数据 → 解析 → 报告画布
  └─ 设计侧为空   → 上传卡片
```

---

## 关键文件清单

| 文件 | 角色 |
|---|---|
| `client/src/views/utils/message.ts` | Messenger 消息协议 |
| `client/src/views/consistency/init/detectIframe.ts` | 检测/监听/派发事件，导出 `UXLINT_CHECKLIST_EVENT` |
| `client/src/views/consistency/init/index.ts` | `initApp` 调 `detectIframe`，透出卸载函数 |
| `client/src/views/consistency/init/processUxlintCheckList.ts` | 建交付件/页面，返回最后一个版本 |
| `client/src/views/consistency/ConsistencyView.vue` | `onUxlintCheckList` + `loadHistoryVersion` |
| `client/src/views/testIframe/TestIframeView.vue` | 测试父页面（外网） |
| `client/src/router/index.ts` | `/testIframe` 路由 |
| `mock/routes/uxlintTest.js` + `index.js` | 测试数据路由（外网） |

---

## 注意事项

- **内网替换**：`TestIframeView.vue` 与 `mock/routes/uxlintTest.js` 仅外网测试用；内网由真实宿主系统下发消息、提供数据地址，这两者不参与。
- **职责边界**：`detectIframe` 只翻译消息，不碰业务；业务处理在 `processUxlintCheckList`（init 层），状态更新在 `ConsistencyView`（组件层）。
- **空容忍仅限被动渲染**：`loadHistoryVersion` 的"某侧空 → 卡片"对所有历史加载生效，但**不影响**上传页主动对比的两侧齐全校验。
- **域名替换**：所有来自父页面的远程 URL 必须经 `replaceOrigin` 换成当前域名才能 fetch。
- **串行建页面**：`processUxlintCheckList` 对 list 串行处理，保证交付件下页面顺序稳定，最终展示最后一个页面。
- **设计侧恒空**：当前 checkList 只携带开发侧数据，建页面时设计侧入参传 `''`（空字符串），接口回读该版本时设计侧字段为 `null`；二者都被空判断 `!version.designBase64Data` 命中，因此渲染时设计侧必然走卡片，等待用户后续补设计稿再对比。
