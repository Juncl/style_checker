<template>
  <div class="phone-card">
    <input ref="pickerJson"  type="file" accept=".json" style="display:none" @change="onJsonPicked" />
    <input ref="pickerImage" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" style="display:none" @change="onImagePicked" />
    <div class="phone-bg"></div>
    <div class="phone-content">
      <!-- debugger 模式 -->
      <template v-if="debugMode">
        <!-- 传送码模式 -->
        <div v-if="debugStep3Mode" class="up-url-group">
          <div v-if="urlLoading" class="url-loading-overlay">
            <OctoLoading :size="48" />
            <span class="url-loading-text">加载中</span>
          </div>
          <div class="up-step-title up-step-title--center up-step-title--row">
            <span>Step3:输入传送码</span>
            <button class="debug-inline-toggle" @click="debugStep3Mode = false" title="切换到文件上传">⇄ 切换</button>
          </div>
          <div class="up-url-card">
            <img :src="iconStep3" class="up-url-icon" alt="" />
            <el-input
              v-model="annotationUrl"
              placeholder="请输入传送码/标注视图URL"
              class="up-url-input"
              @keyup.enter="validateAnnotationUrl"
            />
          </div>
          <el-button
            type="primary"
            class="up-url-btn"
            :disabled="!annotationUrl.trim()"
            @click="validateAnnotationUrl"
          >确认</el-button>
        </div>
        <!-- 文件上传模式 -->
        <div v-else class="up-upload-card">
          <div class="up-step-title up-step-title--center up-step-title--row">
            <span>调试对比</span>
            <button class="debug-inline-toggle" @click="debugStep3Mode = true" title="返回传送码模式">⇄ 返回</button>
          </div>
          <div class="up-step">
            <div class="up-step-title up-step-title--center"><span>Step3：上传 JSON</span></div>
            <div
              :class="['up-drop', { 'has-file': designJson }]"
              @click="pickerJson?.click()"
            >
              <img v-if="!designJson" :src="iconJson" class="up-drop-icon" alt="" />
              <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
              <div v-if="!designJson" class="up-drop-text">
                <span class="up-link" @click.stop="pickerJson?.click()">单击上传</span>
                <span class="up-drop-sub">(.json)</span>
              </div>
              <span v-else class="up-drop-done">{{ designJson.name }}</span>
            </div>
          </div>
          <div class="up-step">
            <div class="up-step-title up-step-title--center"><span>Step4：上传图片</span></div>
            <div
              :class="['up-drop', { 'has-file': designImage, 'is-disabled': !designJson }]"
              @click="triggerImage"
            >
              <img v-if="!designImage" :src="iconImage" class="up-drop-icon" alt="" />
              <el-icon v-else class="up-drop-check"><CircleCheck /></el-icon>
              <div v-if="!designImage" class="up-drop-text">
                <span class="up-link" @click.stop="triggerImage">单击上传</span>
                <span class="up-drop-sub">(.png, .jpg ...)</span>
              </div>
              <span v-else class="up-drop-done">{{ designImage.name }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 非 debugger 模式：URL / 传送码输入 -->
      <div v-else class="up-url-group">
        <div v-if="urlLoading" class="url-loading-overlay">
          <OctoLoading :size="48" />
        </div>
        <div class="up-step-title up-step-title--center">
          <span>Step3:输入传送码/标注视图URL</span>
        </div>
        <div class="up-url-card">
          <img :src="iconStep3" class="up-url-icon" alt="" />
          <el-input
            v-model="annotationUrl"
            placeholder="请输入传送码/标注视图URL"
            class="up-url-input"
            @keyup.enter="validateAnnotationUrl"
          />
        </div>
        <el-button
          type="primary"
          class="up-url-btn"
          :disabled="!annotationUrl.trim()"
          @click="validateAnnotationUrl"
        >确认</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheck } from '@element-plus/icons-vue'
import OctoLoading from './common/OctoLoading.vue'
import { getJsonImage } from '../../utils-inner/getJsonImage'
import { transferCode } from '../init/handleTransferCode'
import iconJson from '@/assets/upload-json.png'
import iconImage from '@/assets/upload-image.png'
import iconStep3 from '@/assets/svg/Step3-up.svg'

const props = defineProps({
  designJson:  { type: Object,  default: null },
  designImage: { type: Object,  default: null },
  debugMode:   { type: Boolean, default: false },
})

const emit = defineEmits(['step-picked'])

const annotationUrl  = ref('')
const urlLoading     = ref(false)
const debugStep3Mode = ref(true)
const pickerJson     = ref(null)
const pickerImage    = ref(null)

watch(() => props.designJson, newVal => {
  if (!newVal) {
    annotationUrl.value = ''
    urlLoading.value    = false
  }
})

// 外部跳转携带传送码时，回填到输入框
watch(transferCode, code => {
  if (code) {
    annotationUrl.value = code
  }
})

function triggerImage() {
  if (!props.designJson) {
    ElMessage.warning('请先完成 Step 3：上传 JSON')
    return
  }
  pickerImage.value?.click()
}

async function validateAnnotationUrl() {
  const code = annotationUrl.value.trim()
  if (!code) return
  urlLoading.value = true
  try {
    const result = await getJsonImage({ url: code })
    if (!result.valid) {
      ElMessage.error(result.errorMsg || '传送码不合规，请检查输入')
      return
    }
    if (result.designJson) {
      const jsonBlob = new Blob([JSON.stringify(result.designJson)], { type: 'application/json' })
      emit('step-picked', { type: 'designJson', file: new File([jsonBlob], 'design.json', { type: 'application/json' }) })
    }
    if (result.designImageUrl) {
      const [meta, b64] = result.designImageUrl.split(',')
      const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/png'
      const ext = mimeType.split('/')[1] || 'png'
      const imageBlob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mimeType })
      emit('step-picked', { type: 'designImage', file: new File([imageBlob], `design.${ext}`, { type: mimeType }) })
    }
    ElMessage.success('设计稿获取成功')
  } catch (e) {
    ElMessage.error('设计稿获取失败，请检查标注视图URL或传送码后重试')
  } finally {
    urlLoading.value = false
  }
}

function onJsonPicked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json')) {
    ElMessage.error('请上传 .json 文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'designJson', file })
  event.target.value = ''
}

function onImagePicked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
  if (!file.type.startsWith('image/') && !validExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
    ElMessage.error('请上传图片文件')
    event.target.value = ''
    return
  }
  emit('step-picked', { type: 'designImage', file })
  event.target.value = ''
}
</script>
