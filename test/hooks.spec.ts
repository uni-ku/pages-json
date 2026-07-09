import { describe, expect, it } from 'vitest';
import { hookUniPlatform } from '../src/hooks';

function filter(platform: 'h5' | 'mp-weixin', filePaths: string[]) {
  return hookUniPlatform.filterPages!(platform, filePaths.map(filePath => ({ filePath, pagePath: filePath })));
}

describe('hookUniPlatform.filterPages', () => {
  it('保留无平台后缀的默认页面', async () => {
    const result = await filter('h5', ['src/pages/index/index.vue']);
    expect(result).toHaveLength(1);
  });

  it('保留匹配平台页面，过滤其他平台', async () => {
    const result = await filter('h5', [
      'src/pages/index/index.h5.vue',
      'src/pages/index/index.mp-weixin.vue',
    ]);
    expect(result.map(o => o.filePath)).toEqual(['src/pages/index/index.h5.vue']);
  });

  // 回归：旧正则 [^.]+ 跨 / 匹配，路径中的点（如 /root/.jenkins/）使 matched[2]
  // 错误命中路径段而非平台后缀，导致默认页面被全部过滤（pages.json pages 为空）
  it('绝对路径含点（.jenkins）不误过滤默认页面', async () => {
    const result = await filter('h5', ['/root/.jenkins/workspace/proj/src/pages/index/index.vue']);
    expect(result).toHaveLength(1);
  });

  it('绝对路径含点时仍按平台后缀过滤', async () => {
    const result = await filter('h5', [
      '/root/.jenkins/workspace/proj/src/pages/index/index.h5.vue',
      '/root/.jenkins/workspace/proj/src/pages/index/index.mp-weixin.vue',
    ]);
    expect(result.map(o => o.filePath)).toEqual(['/root/.jenkins/workspace/proj/src/pages/index/index.h5.vue']);
  });

  it('windows 绝对路径正常', async () => {
    const result = await filter('h5', ['E:\\platform\\proj\\src\\pages\\index\\index.vue']);
    expect(result).toHaveLength(1);
  });
});
