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
    apikey: 'Bearer 3a96de3ddfa3437781f19ac21217fe20.75dUs9bpFxqTMTYZ',
  },
  INNER: {
    model: 'Qwen3.5-27B-Claude-4.6',
    url: 'http://',
    apikey: 'xxxx',
  },
}
