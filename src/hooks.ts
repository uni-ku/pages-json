import type { ConfigHook } from './config';

export const hookUniPlatform: ConfigHook = {
  parsePageOption: (opt) => {
    opt.pagePath = opt.pagePath.replace(/\..*$/, '');
    return opt;
  },
  filterPages: (platform, opts) => {
    return opts.filter((opt) => {
      // 仅在文件名（basename）上匹配 name.platform.ext，
      // 避免 [^.]+ 跨目录分隔符匹配到路径中的点（如 /root/.jenkins/...），
      // 导致 matched[2] 错误地命中路径段而非平台后缀
      const basename = opt.filePath.replace(/^.*[\\/]/, '');
      const matched = basename.match(/([^.]+)\.([^.]+)\.([^.]+)$/);
      return !matched || matched[2] === platform;
    });
  },
};
