/**
 * 全局常量配置
 */

// 当前开发环境
export const DEV_ENV = "OUT";
// export const DEV_ENV = "INNER";

// AI 检视接口配置（外网 / 内网）
export const VLM_CONFIG = {
  OUT: {
    model: 'glm-4.6v',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apikey: 'Bearer ee9949a9ddea4f019772e2d3abbf15bf.DpNYbrsH5iYt85cT',
  },
  INNER: {
    model: 'Qwen3.5-27B-Claude-4.6',
    url: 'http://',
    apikey: 'xxxx',
  },
}

// 间距对比允许的误差范围（vp）
// 两侧间距差值 <= 此值时视为一致，不报差异
export const SPACE_ERR_RANGE = 3
