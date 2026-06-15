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
            :class="['up-drop', { 'has-file': arkuiJson, 'drag-over': jsonDragOver }]"
            @click="triggerJson"
            @dragenter.prevent.stop="jsonDragOver = true"
            @dragover.prevent.stop="jsonDragOver = true"
            @dragleave.prevent.stop="onDragLeave($event, v => (jsonDragOver = v))"
            @drop.prevent.stop="onJsonDrop"
          >
            <img v-if="!arkuiJson" :src="iconJson" class="up-drop-icon" alt="" />
            <img v-else :src="iconSuccess" class="up-drop-icon" alt="" />
            <div v-if="!arkuiJson" class="up-drop-text">
              <span class="up-drop-sub">获取指南：<span class="up-guide-links"><a class="up-link" :href="GUIDE_LINKS.terminal" target="_blank" rel="noopener" @click.stop>鸿蒙</a>｜<a class="up-link" :href="GUIDE_LINKS.web" target="_blank" rel="noopener" @click.stop>Web</a></span></span>
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
            :class="['up-drop', { 'has-file': arkuiImage, 'drag-over': imageDragOver, 'is-disabled': !arkuiJson }]"
            @click="triggerImage"
            @dragenter.prevent.stop="arkuiJson && (imageDragOver = true)"
            @dragover.prevent.stop="arkuiJson && (imageDragOver = true)"
            @dragleave.prevent.stop="onDragLeave($event, v => (imageDragOver = v))"
            @drop.prevent.stop="onImageDrop"
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
  platform:         { type: String,  default: 'hmPhone' },
  showDownloadLink: { type: Boolean, default: true },
})

const emit = defineEmits(['pick-json', 'pick-image'])

const pickerJson  = ref(null)
const pickerImage = ref(null)

// Step1 / Step2 各自独立的拖拽高亮状态，互不影响
const jsonDragOver  = ref(false)
const imageDragOver = ref(false)

// dragleave 在进入子元素时也会触发，用 relatedTarget 判断是否真正离开拖拽区
function onDragLeave(e, setter) {
  if (!e.currentTarget.contains(e.relatedTarget)) setter(false)
}

function onJsonDrop(e) {
  jsonDragOver.value = false
  handleJsonFile(e.dataTransfer.files?.[0])
}

function onImageDrop(e) {
  imageDragOver.value = false
  handleImageFile(e.dataTransfer.files?.[0])
}

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

function handleJsonFile(file) {
  if (!file) return
  if (!file.name.endsWith('.json') && !file.name.endsWith('.dump')) {
    ElMessage.error('请上传 .json 或 .dump 文件')
    return
  }
  emit('pick-json', file)
}

function handleImageFile(file) {
  if (!file) return
  if (!props.arkuiJson) {
    ElMessage.warning('请先完成 Step 1：上传 ArkUI 的 JSON')
    return
  }
  const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
  if (!file.type.startsWith('image/') && !validExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
    ElMessage.error('请上传图片文件')
    return
  }
  emit('pick-image', file)
}

function onJsonPicked(event) {
  handleJsonFile(event.target.files?.[0])
  event.target.value = ''
}

function onImagePicked(event) {
  handleImageFile(event.target.files?.[0])
  event.target.value = ''
}
</script>
