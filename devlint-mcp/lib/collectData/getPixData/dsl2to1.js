
'use strict';

// 判断是否为dsl格式
function detectDslVersion(dsl) {
    if (!dsl || typeof dsl !== 'object') return '非dsl';
    // DSL 1.0 特征： 有manifast 且有 data数组
    if (dsl.manifest && Array.isArray(dsl.data)) return '1.0';
    // DSL 2.0 特征： 有meta 且有 content数组
    if (dsl.meta && Array.isArray(dsl.content)) return '2.0';
    return '非dsl'
}

function convertDsl2To1(dsl) {
    // ...内网实现，这里是占位用
    const dsl1 = {
        manifest: {},
        extend: {},
        data: []
    }

    return {data: dsl1, version: '2.0'};
}

export { convertDsl2To1, detectDslVersion };

