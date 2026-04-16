import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { PageFileOption } from './page-file';
import type { MaybePromise } from './types';
import type { UniPlatform } from './utils/uni-env';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PagesConfigFile } from './pages-config-file';
import { enableDebug } from './utils/debug';

export interface ConfigHook {
  /**
   * 获取页面路径
   * @param filePath - 文件路径
   * @param pagePath - 页面路径
   * @returns page path 页面路径
   */
  parsePageOption?: (opt: PageFileOption) => MaybePromise<PageFileOption>;
  /**
   * 过滤、修改 pages 的页面文件信息
   */
  filterPages?: (platform: UniPlatform, opts: PageFileOption[]) => MaybePromise<PageFileOption[]>;
  /**
   * 修改生成的页面配置
   * 返回 null 可忽略该页面
   */
  transformPage?: (platform: UniPlatform, page: PagesJSON.Page, opt: PageFileOption) => MaybePromise<PagesJSON.Page | null>;
}

export interface UserConfig {
  /**
   * 项目根目录
   * @default process.env.UNI_CLI_CONTEXT || process.cwd()
   */
  root?: string;

  /**
   * 源码目录
   * pages.json 放置的目录
   * @default process.env.UNI_INPUT_DIR || path.resolve(root, 'src') || root
   */
  src?: string;

  /**
   * pages 绝对路径或基于源码目录的相对路径
   * @default 'pages'
   */
  pageDir?: string;

  /**
   * subPackages 绝对路径或基于源码目录的相对路径
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除条件，应用于 pages 和 subPackages 的文件
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  exclude?: string[];

  /**
   * 为页面路径生成 TypeScript 声明
   * 绝对路径或基于源码目录的相对路径
   * false 则取消生成
   * @default "pages.d.ts"
   */
  dts?: string | boolean;

  /**
   * 显示调试
   * @default false
   */
  debug?: boolean | 'info' | 'error' | 'debug' | 'warn';

  /**
   * 钩子
   */
  hooks?: ConfigHook[];

  /**
   * 缓存目录
   * @default 'node_modules/.cache/@uni-ku/pages-json'
   */
  cacheDir?: string;

  /**
   * 运行平台
   */
  platform?: UniPlatform | UniPlatform[];

  /**
   * pages.json 格式化缩进，默认使用 4 个空格缩进
   */
  indent?: string | number;
}

export interface ResolvedConfig extends Required<Omit<UserConfig, 'platform'>> {
  /**
   * 运行平台
   */
  platform: UniPlatform[];

  /**
   * pages.json.ts 文件的可用路径
   */
  pagesJsonFilePaths: string[];
}

export function resolveConfig(useConfig: UserConfig): ResolvedConfig {
  let {
    root = process.env.UNI_CLI_CONTEXT || process.cwd(),
    src = process.env.UNI_INPUT_DIR,
    dts = true,
    pageDir = 'pages',
    subPackageDirs = [],
    exclude = ['node_modules', '.git', '**/__*__/**'],
    debug = false,
    hooks = [],
    cacheDir = path.join('node_modules', '.cache', '@uni-ku', 'pages-json'),
    platform = [],
    indent = 4,
  } = useConfig;

  if (!src) {
    const maybe = path.resolve(root, 'src');
    src = fs.existsSync(maybe) ? maybe : root;
  }

  if (!path.isAbsolute(cacheDir)) {
    cacheDir = path.resolve(root, cacheDir);
  }

  enableDebug(debug);

  const absPageDir = path.isAbsolute(pageDir) ? pageDir : path.resolve(src, pageDir);
  const absSubPackageDirs = subPackageDirs.map((dir) => {
    return path.isAbsolute(dir) ? dir : path.resolve(src, dir);
  });

  const pagesJsonFilePaths: string[] = [];
  for (const dir of [root, src]) {
    for (const ext of PagesConfigFile.exts) {
      pagesJsonFilePaths.push(path.join(dir, PagesConfigFile.basename + ext));
    }
  }

  return {
    root,
    src,
    pageDir: absPageDir,
    subPackageDirs: absSubPackageDirs,
    exclude,
    dts: dts === true ? path.join(src, 'pages.d.ts') : dts,
    debug,
    hooks,
    cacheDir,
    platform: Array.isArray(platform) ? platform : [platform],
    pagesJsonFilePaths,
    indent,
  };
}
