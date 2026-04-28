# HarmonyOS 设计还原检查系统 — Case 深度分析与技术方案

## 一、Case 数据全景

| Case | 应用场景 | Design 节点 | ArkUI 节点 | 分辨率 | 设计画布 | ArkUI 视口(vp) |
|------|---------|------------|------------|-------|---------|---------------|
| case1 | 主题商店·皮肤详情 | 138 | 671 | 3.25× | 360×792 | 374×827 |
| case2 | 音乐·我的页 | 351 | 1414 | 3.50× | 360×792 | 376×809 |
| case3 | 相机·照片详情 | 213 | 493 | 3.50× | 360×891 | 376×809 |
| case4 | 健康·今日 | 433 | 944 | 3.50× | 360×792 | 376×809 |
| case5 | 地图·导航中 | 404 | 1625 | 3.50× | 360×792 | 376×809 |
| case6 | 地图·设置面板 | 102 | 1731 | 3.50× | 360×792 | 376×809 |
| case7 | 天气·90日日历 | 1003 | 1426 | 3.50× | 360×947 | 376×809 |
| case8 | 天气·生活指数 | 248 | 1078 | 3.50× | 360×1037 | 376×809 |
| case9 | 天气·主页 | 311 | 631 | 3.50× | 360×741 | 376×809 |
| case10 | 健康·锻炼 | 359 | 742 | 3.50× | 360×792 | 376×809 |
| case11 | 健康·我的 | 327 | 890 | 3.50× | 360×987 | 376×809 |
| case12 | 健康·今日(彩环) | 440 | 788 | 3.38× | 360×792 | 373×843 |

**结论**：ArkUI 节点数是 Design 节点数的 3-17 倍，大量是框架内部节点，不是视觉元素。

---

## 二、数据结构深度分析

### 2.1 design.json 结构

```
{
  manifest: { count: { layer, cut } },
  extend: {
    autoExports: [...],          // 导出切图
    componentData: {...},        // 组件实例数据（Figma 组件库引用）
    styleData: {...},            // 样式 token 引用（色彩/字体规范来源）
    blobPath: {...}
  },
  data: [Node, ...]              // 138-1003 个节点的扁平数组，用 path 表达层级
}
```

每个 Node 的关键字段：

```json
{
  "guid": "14:2260",             // Figma 节点 ID
  "path": [0, 0, 0, 0],         // 在树中的索引路径，可还原层级关系
  "type": "TEXT|FRAME|RECTANGLE|GROUP|BOOLEAN_OPERATION|VECTOR|ELLIPSE",
  "name": "机械键盘",
  "content": "机械键盘",          // 仅 TEXT 节点有
  "rect": { "w": 40, "h": 14, "x": 24, "y": 169 },  // 单位：dp（设计像素）
  "state": { "visible": true },
  "style": {
    "opacity": 1,
    "background": [{ "type": "SOLID", "color": "#f1f3f5ff" }],
    "borderRadius": [10, 10, 10, 10],     // [左上, 右上, 右下, 左下] dp
    "border": { "color": "...", "width": 1, "style": "solid" },
    "blur": [{ "type": "background|filter", "blur": 54.37 }],
    "shadows": [{ "color": "#00000033", "type": "out", "blur": 60, "x": 0, "y": 0 }],
    "text": [{
      "characters": "机械键盘",
      "fontSize": 10,            // dp
      "fontWeight": 400,         // 数值：400/500/700/900
      "fontFamily": "HarmonyHeiTi",
      "lineHeight": 1,           // 倍数
      "letterSpacing": 0,
      "textDecorationLine": "unset",
      "data": [{ "type": "SOLID", "color": "#00000099" }]  // #RRGGBBaa 格式
    }],
    "textAlign": "center|left|right"
  },
  "layout": {
    "container": {
      "padding": [8, 24, 8, 24],          // [上, 右, 下, 左] dp
      "axis": {
        "primary": { "spacing": 10 }      // 子元素间距 dp
      }
    },
    "element": {
      "position": { "x": 8, "y": 3, "absolute": false }
    }
  }
}
```

### 2.2 arkui.json 结构

```
{
  type: "root",
  content: {
    $type: "root",
    width: 1216.0,         // 物理像素
    height: 2688.0,
    $resolution: 3.25,     // 物理px / vp 的比值
    $children: [JsView → Navigation → ... ]  // 深度递归树
  },
  VsyncID, ProcessID, WindowID
}
```

每个节点关键字段：

```json
{
  "$type": "Text|Row|Column|Flex|Stack|Image|Button|Scroll|...",
  "$ID": 397,
  "$rect": "[52.00, 133.00],[222.00,263.00]",   // 物理像素坐标 [左上],[右下]
  "$debugLine": "{\"$line\":\"(0:0)\"}",
  "viewTag": "...",
  "$attrs": {
    "fontSize": "16.00fp",               // fp 或 vp，设备无关单位
    "fontWeight": "FontWeight.Medium",   // 枚举字符串
    "fontColor": "#E5000000",            // #AARRGGBB 格式
    "fontFamily": "HarmonyOS Sans",
    "lineHeight": "0.00vp",
    "letterSpacing": "0.00px",
    "textAlign": "TextAlign.Start",
    "backgroundColor": "#00000000",
    "borderRadius": { "topLeft": "10.00vp", ... },
    "borderWidth": "0.00vp",
    "borderColor": "#FF000000",
    "padding": "0.00vp",              // 或 JSON 字符串 {"top":"8vp","right":"24vp",...}
    "margin": "0.00vp",
    "opacity": 1,
    "blur": 0,                        // filter blur
    "backdropBlur": 54.37,            // background blur
    "shadow": { "radius": "60.0", "color": "#33000000", "offsetX": "0", "offsetY": "0" },
    "width": "52.30vp",
    "height": "100.00%",
    "size": { "width": "...", "height": "..." },
    "visibility": "Visibility.Visible",
    "content": "机械键盘"              // Text 节点的文字内容
  },
  "$children": [...]
}
```

---

## 三、关键规律总结

### 3.1 坐标 & 单位系统

| 维度 | Design | ArkUI | 换算关系 |
|-----|--------|-------|---------|
| 坐标系 | dp（逻辑像素） | 物理像素 $rect | dp × resolution = px |
| 字体/间距单位 | dp | vp / fp | **dp ≈ vp**（设备无关，直接对比） |
| 画布宽度 | 360 dp | 373–376 vp | 比例差约 3.9–4.4%，需归一化 |
| 位置匹配 | x, y, w, h | $rect 解析后 ÷ resolution | 误差容忍 ±2vp |

**注意**：fp（font pixel）在系统默认字体缩放下等于 vp，若用户开启了字体放大则 actualFontSize 会与 fontSize 不同。

### 3.2 样式值格式转换规则

| 属性 | Design 格式 | ArkUI 格式 | 转换方法 |
|-----|------------|-----------|---------|
| 颜色 | `#RRGGBBaa`（小写 alpha 在末尾） | `#AARRGGBB`（大写 alpha 在首位） | 末尾 aa 提前 + 全大写 |
| 字重 | 数值 400/500/700/900 | 枚举字符串 | 见下方映射表 |
| 字体族 | 逻辑名称 | 系统实际字体文件名 | 见下方映射表 |
| 文字对齐 | `"center"/"left"/"right"` | `"TextAlign.Center/Start/End"` | 固定映射 |
| 圆角 | `[tl, tr, br, bl]` (dp 数组) | `{topLeft, topRight, bottomRight, bottomLeft}` (vp 字符串) | 解析后数值对比 |
| 内边距 | `[top, right, bottom, left]` (dp) | `"N.00vp"` 或 JSON 字符串 | 解析后各方向对比 |
| 背景模糊 | `{type:"background", blur: 54.37}` | `backdropBlur: 54.37` | 数值直接对比（±2 容差） |
| 投影 | `{color, blur, x, y, extend}` | `shadow: {radius, color, offsetX, offsetY}` | 逐字段对比 |
| 不透明度 | `opacity: 0–1` | `opacity: 0–1` | 直接对比 |

**字重映射**：

| Design | ArkUI |
|--------|-------|
| 0 / 400 | `FontWeight.Normal` / `FontWeight.Regular` / `"400"` |
| 500 | `FontWeight.Medium` / `"500"` |
| 600 | `FontWeight.Medium` / `"600"` |
| 700 | `FontWeight.Bold` / `"700"` |
| 900 | `FontWeight.Bolder` / `"900"` |

**字体族映射**（等价别名）：

| Design | ArkUI 等价 |
|--------|-----------|
| `HarmonyHeiTi` | `HarmonyOS Sans` / `HwChinese-medium` / `HarmonyHeiTi-Medium` |
| `HarmonyOS Sans SC` | `HarmonyOS_Sans_SC` / `HarmonyOS_Sans_SC_Bold` |
| `HarmonyOS Digit` | `hw-digit-bold-LL` |
| `HM Symbol` | `HM Symbol` |
| `Helvetica` | `Helvetica` |

### 3.3 节点类型映射

| Design 节点类型 | 对应 ArkUI 组件 |
|---------------|----------------|
| TEXT | Text / Span |
| FRAME（横向排列）| Row / Flex |
| FRAME（纵向排列）| Column / Flex |
| FRAME（叠层）| Stack |
| RECTANGLE | 无对应（通常是 Row/Column 的 background 属性） |
| VECTOR / BOOLEAN_OPERATION | Image / SymbolGlyph |
| ELLIPSE | 无对应（通常是 background + borderRadius 圆形） |
| GROUP | Row / Column / Stack |

### 3.4 节点数量不对称的原因

ArkUI 节点是 Design 的 3–17 倍，原因：
1. **框架基础节点**：Navigation、NavBar、JsView、Divider、ScrollBar 等
2. **状态栏/导航栏**：`$rect=[0,0],[0,0]` 或 visibility=None 的隐藏节点大量存在
3. **Span 层级**：一个 Text 节点下会有多个 Span 子节点
4. **容器嵌套**：Row > Column > Stack 多层包裹来实现一个视觉容器
5. **触摸区域扩展**：Button 等组件自带不可见的点击区域节点

---

## 四、典型差异类型

从 12 个 case 的视觉观察和数据对比，整理出以下差异类型：

### A 类 — 文字样式差异（可精确检测）
- 字号偏差（如 design:16dp，实现:14vp）
- 字重偏差（design:500/Medium，实现:400/Normal）
- 字色偏差（颜色值不匹配）
- 字体族偏差（使用了非规范字体）
- 行高偏差
- 字间距偏差
- 文字对齐偏差（case2 底部 Tab 文字 design:center，ArkUI:Start）

### B 类 — 容器样式差异（可精确检测）
- 背景色偏差
- 圆角偏差（如 design:12dp，实现:8vp）
- 透明度偏差
- 内边距偏差（各方向）
- 子元素间距偏差
- 描边/边框偏差

### C 类 — 视觉效果差异（需阈值比较）
- 背景模糊（backdropBlur）数值偏差
- 投影参数偏差（radius、颜色、偏移量）
- 颜色渐变参数偏差

### D 类 — 结构差异（需 AI 辅助）
- 元素缺失（design 有，实现没有）
- 元素多余（实现有，design 没有）
- 布局方向错误（横排变纵排）
- 层级关系错误
- 图标/图片资源替换错误

---

## 五、技术方案

### 5.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    输入层 (Input Layer)                      │
│  design.json + arkui.json + design.png + arkui.png          │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   解析与归一化层 (Parser)                    │
│                                                              │
│  DesignParser                    ArkUIParser                 │
│  ├── 还原 path 为树形结构         ├── 过滤框架节点             │
│  ├── 提取视觉样式属性             ├── 解析 $rect 为 vp 坐标    │
│  ├── 颜色格式 #RRGGBBaa→ARGB    ├── 字重枚举→数值标准化       │
│  └── dp 坐标标准化               └── 字体族别名统一           │
│                                                              │
│  统一中间表示 (UnifiedNode):                                 │
│  { id, type, rect(vp), text?, fontSize?, fontWeight?,       │
│    fontColor?, fontFamily?, textAlign?, backgroundColor?,   │
│    borderRadius?, padding?, opacity?, blur?, shadow? }      │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   节点匹配层 (Matcher)                       │
│                                                              │
│  Pass 1: 文本内容精确匹配                                    │
│    design TEXT.content == arkui Text.$attrs.content         │
│    + 位置接近（归一化坐标误差 < 5%）                          │
│                                                              │
│  Pass 2: 几何重叠匹配                                        │
│    IoU（交并比）> 0.6 的容器节点匹配                          │
│    优先级：大容器先匹配，自顶向下                              │
│                                                              │
│  Pass 3: 结构相似性匹配（LLM）                               │
│    对 Pass 1/2 未匹配节点，发送给 Claude 视觉模型             │
│    输入：截图 + 节点样式描述 → 输出：匹配 ID 对               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   样式比对层 (Comparator)                    │
│                                                              │
│  对每个匹配节点对，逐属性对比：                               │
│                                                              │
│  字体类: fontSize / fontWeight / fontColor /                 │
│          fontFamily / textAlign / lineHeight               │
│                                                              │
│  容器类: backgroundColor / borderRadius /                   │
│          padding / margin / opacity                        │
│                                                              │
│  效果类: blur(backdropBlur) / shadow                        │
│                                                              │
│  容差配置（可配置）:                                         │
│  ├── fontSize: ±0.5vp                                       │
│  ├── 颜色: 完全匹配（归一化后）或 ΔE < 5                     │
│  ├── 间距: ±1vp                                             │
│  └── 模糊/投影: ±5%                                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   报告生成层 (Reporter)                      │
│                                                              │
│  结构化 Diff JSON:                                          │
│  { nodeId, nodeType, content?, property,                    │
│    designValue, arkuiValue, severity(error/warn/info) }     │
│                                                              │
│  可视化标注图（在截图上框出问题区域 + 标注差异值）            │
│                                                              │
│  自然语言摘要报告（Claude 生成）                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 核心模块实现

#### 5.2.1 坐标归一化

```python
DESIGN_CANVAS_WIDTH = 360.0  # dp

def normalize_design_rect(rect, design_canvas_w=360.0) -> Rect:
    """将 design dp 坐标转换为归一化坐标（0-1 比例）"""
    return Rect(
        x=rect['x'] / design_canvas_w,
        y=rect['y'] / design_canvas_w,  # 保持宽高比一致
        w=rect['w'] / design_canvas_w,
        h=rect['h'] / design_canvas_w,
    )

def normalize_arkui_rect(rect_str, resolution, canvas_w_px) -> Rect:
    """解析 ArkUI $rect 字符串，转换为归一化坐标"""
    # "[52.00, 133.00],[222.00,263.00]"
    x1, y1, x2, y2 = parse_rect_string(rect_str)
    vp_w = canvas_w_px / resolution
    return Rect(
        x=(x1 / resolution) / vp_w,
        y=(y1 / resolution) / vp_w,
        w=((x2 - x1) / resolution) / vp_w,
        h=((y2 - y1) / resolution) / vp_w,
    )
```

#### 5.2.2 颜色归一化

```python
def normalize_color(color: str, source: str) -> str:
    """统一转换为 #AARRGGBB 大写格式"""
    h = color.lstrip('#')
    if source == 'design':
        if len(h) == 8:  # #RRGGBBaa
            r, g, b, a = h[0:2], h[2:4], h[4:6], h[6:8]
            return f'#{a}{r}{g}{b}'.upper()
        elif len(h) == 6:  # #RRGGBB
            return f'#FF{h}'.upper()
    elif source == 'arkui':
        return f'#{h}'.upper()
    return color.upper()
```

#### 5.2.3 Pass 1 文本节点匹配

```python
def match_text_nodes(design_texts, arkui_texts):
    """
    精确匹配文本节点:
    1. 文本内容完全相同
    2. 归一化坐标 IoU > 0.3 或 y 轴距离 < 0.05
    """
    matched_pairs = []
    used_arkui = set()
    
    for d_node in design_texts:
        candidates = [
            a for a in arkui_texts
            if a.id not in used_arkui
            and a.content == d_node.content
        ]
        if not candidates:
            continue
        
        # 按归一化位置距离排序，取最近的
        best = min(candidates, key=lambda a: position_distance(d_node.rect, a.rect))
        if position_distance(d_node.rect, best.rect) < 0.08:
            matched_pairs.append((d_node, best))
            used_arkui.add(best.id)
    
    return matched_pairs
```

#### 5.2.4 样式属性对比器

```python
@dataclass
class StyleDiff:
    property: str
    design_value: Any
    arkui_value: Any
    severity: str  # "error" | "warning" | "info"
    description: str

def compare_text_style(design_node, arkui_node) -> List[StyleDiff]:
    diffs = []
    
    # 字号
    d_fs = design_node.style.text[0].fontSize  # dp 数值
    a_fs = parse_vp(arkui_node.attrs.fontSize)  # 解析 "16.00fp" → 16.0
    if abs(d_fs - a_fs) > 0.5:
        diffs.append(StyleDiff(
            property='fontSize',
            design_value=f'{d_fs}dp',
            arkui_value=arkui_node.attrs.fontSize,
            severity='error',
            description=f'字号偏差 {d_fs - a_fs:+.1f}dp'
        ))
    
    # 字重
    d_fw = design_node.style.text[0].fontWeight
    a_fw = normalize_font_weight(arkui_node.attrs.fontWeight)
    if d_fw != a_fw:
        diffs.append(StyleDiff('fontWeight', d_fw, arkui_node.attrs.fontWeight, 'error', '字重不匹配'))
    
    # 颜色
    d_color = normalize_color(design_node.style.text[0].data[0].color, 'design')
    a_color = normalize_color(arkui_node.attrs.fontColor, 'arkui')
    if d_color != a_color:
        severity = 'error' if color_delta(d_color, a_color) > 10 else 'warning'
        diffs.append(StyleDiff('fontColor', d_color, a_color, severity, '颜色不匹配'))
    
    # 字体族
    d_ff = design_node.style.text[0].fontFamily
    a_ff = arkui_node.attrs.fontFamily
    if not is_equivalent_font(d_ff, a_ff):
        diffs.append(StyleDiff('fontFamily', d_ff, a_ff, 'warning', '字体族不匹配'))
    
    # 文字对齐
    d_ta = design_node.style.textAlign  # "center"/"left"/"right"
    a_ta = normalize_text_align(arkui_node.attrs.textAlign)
    if d_ta != a_ta:
        diffs.append(StyleDiff('textAlign', d_ta, a_ta, 'error', '对齐方式不匹配'))
    
    return diffs
```

### 5.3 AI 增强策略

#### 5.3.1 视觉匹配（Claude Vision）

对 Pass 1/2 未能匹配的节点，调用 Claude API：

```python
async def ai_visual_match(design_png, arkui_png, unmatched_design_nodes):
    """
    输入：两张截图 + 未匹配的 design 节点列表
    输出：匹配对 [(design_node_id, arkui_node_id)]
    """
    prompt = f"""
    左图是设计稿，右图是实机截图。
    以下 design 节点未找到匹配的 ArkUI 节点，请判断：
    1. 该节点在实机截图中是否存在？
    2. 如果存在，描述其在截图中的大致位置。
    3. 如果不存在，是缺失（missing）还是被合并到其他元素中（merged）？
    
    未匹配节点：{json.dumps(unmatched_design_nodes)}
    """
    # 调用 Claude claude-opus-4-7 with vision
    response = await claude.messages.create(
        model="claude-opus-4-7",
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "data": design_b64}},
                {"type": "image", "source": {"type": "base64", "data": arkui_b64}},
                {"type": "text", "text": prompt}
            ]
        }]
    )
```

#### 5.3.2 综合差异报告（Claude Text）

```python
async def generate_report(all_diffs: List[StyleDiff], case_info: dict):
    """生成自然语言格式的设计还原报告"""
    prompt = f"""
    你是一名专业的 HarmonyOS 设计还原 QA 工程师。
    以下是设计稿和实机截图的样式差异数据，请生成一份面向设计师的检查报告：
    
    - 按严重程度分组（Error/Warning/Info）
    - 使用设计师熟悉的术语描述差异
    - 对高频问题给出修复建议
    
    差异数据：{json.dumps(all_diffs)}
    """
```

### 5.4 容差与误报控制

```python
TOLERANCE = {
    'fontSize':        0.5,   # vp，字号最大允许偏差
    'borderRadius':    1.0,   # vp
    'padding':         1.0,   # vp
    'margin':          1.0,   # vp
    'lineHeight':      0.5,   # 倍数
    'opacity':         0.02,  # 0-1
    'blur':            2.0,   # vp
    'shadowRadius':    2.0,   # vp
    'shadowOffset':    1.0,   # vp
    'position':        2.0,   # vp，位置匹配容差
}

# 颜色容差：支持两种模式
COLOR_MODE = 'exact'   # 精确匹配（归一化后）
# COLOR_MODE = 'delta'  # ΔE < 5 允许轻微差异
```

### 5.5 数据流与接口定义

```typescript
// 输入
interface CaseInput {
  caseId: string;
  designJson: DesignJSON;
  arkuiJson: ArkUIJSON;
  designPng: Buffer;      // 可选，用于 AI 视觉匹配
  arkuiPng: Buffer;       // 可选
}

// 统一中间节点
interface UnifiedNode {
  id: string;
  source: 'design' | 'arkui';
  type: 'text' | 'container' | 'image' | 'divider' | 'unknown';
  rect: NormalizedRect;   // {x, y, w, h} 归一化到 0-1 范围
  textContent?: string;
  style: {
    fontSize?: number;              // vp
    fontWeight?: number;            // 400/500/700 等
    fontColor?: string;             // #AARRGGBB
    fontFamily?: string;            // 归一化字体名
    textAlign?: 'left'|'center'|'right';
    lineHeight?: number;            // vp
    backgroundColor?: string;       // #AARRGGBB
    borderRadius?: {tl:number, tr:number, br:number, bl:number};  // vp
    padding?: {top:number, right:number, bottom:number, left:number};  // vp
    opacity?: number;
    blur?: number;                  // backdropBlur vp
    shadow?: ShadowStyle;
  };
}

// 输出
interface CheckResult {
  caseId: string;
  matchedPairs: MatchedPair[];
  unmatchedDesign: UnifiedNode[];   // design 有，arkui 没有
  unmatchedArkUI: UnifiedNode[];    // arkui 有，design 没有（意外元素）
  diffs: StyleDiff[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    overallScore: number;           // 0-100 还原度评分
  };
}
```

---

## 六、工程落地路径

### Phase 1（MVP，1–2 周）
- 实现 DesignParser 和 ArkUIParser
- 实现 Pass 1 文本节点精确匹配
- 实现所有文字样式属性对比（A 类差异）
- 输出结构化 JSON 差异报告
- **验证目标**：在 12 个 case 中，对文本节点达到 90% 匹配精度

### Phase 2（基础容器，2–3 周）
- 实现几何 IoU 匹配（Pass 2）
- 实现容器样式对比（B 类差异）
- 实现可视化标注图（PIL/Canvas 绘制问题框）
- **验证目标**：容器匹配精度 ≥ 75%

### Phase 3（AI 增强，3–4 周）
- 接入 Claude Vision API 实现 Pass 3
- 实现 AI 自然语言报告生成
- 实现 C/D 类差异检测（模糊、投影、缺失元素）
- **验证目标**：整体 precision ≥ 85%，recall ≥ 80%

### Phase 4（产品化）
- Web UI：上传文件 → 实时检查 → 可交互报告
- Figma Plugin 集成（直接读取 design token）
- 差异规则配置化（设计师可调容差）
- 历史版本对比（同一 case 多次开发迭代）

---

## 七、关键风险与对策

| 风险 | 描述 | 对策 |
|-----|------|-----|
| 内容状态差异 | ArkUI 是实时数据（显示真实用户数据），Design 是静态示例值 | 文本节点匹配时，数字/日期类内容采用模式匹配而非精确匹配 |
| 节点过滤噪音 | ArkUI 框架节点太多，误匹配率高 | 过滤 visibility=None、rect=[0,0,0,0]、opacity=0 的节点 |
| 多设备分辨率 | 3.25× 和 3.50× 导致单位换算差异 | 读取 `$resolution` 字段动态计算，不硬编码 |
| 字体别名歧义 | 同一字体有多个名称 | 维护字体别名字典，并支持扩充 |
| 滚动内容截断 | ArkUI 截图可能只显示屏幕内容，设计图是全屏 | 基于 viewport 范围过滤 design 节点，只对比可见区域 |
