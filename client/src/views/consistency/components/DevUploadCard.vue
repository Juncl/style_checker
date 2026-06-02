<template>
  <div class="phone-card">
    <input ref="pickerJson"  type="file" accept=".json,.dump" style="display:none" @change="onJsonPicked" />
    <input ref="pickerImage" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.svg" style="display:none" @change="onImagePicked" />
    <div class="phone-bg"></div>
    <div class="phone-content">
      <div class="up-upload-card">
        <!-- Step1 -->
        <div class="up-step">
          <div class="up-step-title">
            <span>Step1:{{ platform === 'web' ? '上传 JSON文件' : '上传 ArkUI树 JSON/DUMP文件' }}</span>
          </div>
          <div
            :class="['up-drop', { 'has-file': arkuiJson, 'drag-over': isDragOver }]"
            @click="triggerJson"
          >
            <img v-if="!arkuiJson" :src="iconJson" class="up-drop-icon" alt="" />
            <img v-else :src="iconSuccess" class="up-drop-icon" alt="" />
            <div v-if="!arkuiJson" class="up-drop-text">
              <span class="up-drop-sub">获取指南：<span class="up-guide-links"><a class="up-link" :href="GUIDE_LINKS.terminal" target="_blank" rel="noopener" @click.stop>终端</a>｜<a class="up-link" :href="GUIDE_LINKS.web" target="_blank" rel="noopener" @click.stop>Web</a></span></span>
              <span class="up-drop-sub">再将JSON文件拖到此处</span>
            </div>
            <span v-else class="up-drop-done">上传成功</span>
          </div>
        </div>
        <!-- Step2 -->
        <div class="up-step">
          <div class="up-step-title up-step-title--center">
            <span>Step2:上传开发图片</span>
          </div>
          <div
            :class="['up-drop', { 'has-file': arkuiImage, 'drag-over': isDragOver, 'is-disabled': !arkuiJson }]"
            @click="triggerImage"
          >
            <img v-if="!arkuiImage" :src="iconImage" class="up-drop-icon" alt="" />
            <img v-else :src="iconSuccess" class="up-drop-icon" alt="" />
            <div v-if="!arkuiImage" class="up-drop-text">
              <span class="up-drop-sub">将图片拖到此处或</span>
              <span class="up-link" @click.stop="triggerImage">单击上传</span>
            </div>
            <span v-else class="up-drop-done">上传成功</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import iconJson from '@/assets/upload-json.png'
import iconImage from '@/assets/upload-image.png'
import iconSuccess from '@/assets/svg/upload-success.svg'
import { GUIDE_LINKS } from '@/views/utils/constants'

const props = defineProps({
  arkuiJson:        { type: Object,  default: null },
  arkuiImage:       { type: Object,  default: null },
  isDragOver:       { type: Boolean, default: false },
  platform:         { type: String,  default: 'hmPhone' },
  showDownloadLink: { type: Boolean, default: true },
})

const emit = defineEmits(['pick-json', 'pick-image'])

const pickerJson  = ref(null)
const pickerImage = ref(null)

function triggerJson() {
  pickerJson.value?.click()
}

function triggerImage() {
  if (!props.arkuiJson) {
    ElMessage.warning('请先完成 Step 1：上传 ArkUI 的 JSON')
    return
  }
  pickerImage.value?.click()
}

function onJsonPicked(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json') && !file.name.endsWith('.dump')) {
    ElMessage.error('请上传 .json 或 .dump 文件')
    event.target.value = ''
    return
  }
  emit('pick-json', file)
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
  emit('pick-image', file)
  event.target.value = ''
}
</script>
