import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { ResolvedConfig } from './config';
import type { PageFileOption } from './page-file';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import { stringifyPagesJsons } from './condition';
import { writeDeclaration } from './declaration';
import { PageFile } from './page-file';
import { PagesConfigFile } from './pages-config-file';
import { debug } from './utils/debug';
import { checkFileSync, detectIndent } from './utils/file';
import { deepAssign } from './utils/object';
import { currentPlatform, type UniPlatform } from './utils/uni-env';
import { slash, sleep } from './utils/utils';

interface JsonFileInfo {
  indent: string | number;
  eof: string;
  content: string;
}

export class Context {

  /**
   * 配置
   */
  private readonly cfg: ResolvedConfig;

  /**
   * 全局动态 pages.json 文件
   */
  private pagesConfigFile: PagesConfigFile;

  /**
   * Map<filepath, PageFile>
   */
  public files = new Map<string, PageFile>();

  /**
   * json 文件路径
   */
  private jsonFilePath: string;

  /**
   * json 文件信息
   */
  private jsonFileInfo?: JsonFileInfo;

  /**
   * 更新状态
   */
  private updating: Promise<boolean> | null = null;

  constructor(config: ResolvedConfig) {
    this.cfg = config;
    this.pagesConfigFile = new PagesConfigFile(config);

    this.jsonFilePath = path.join(this.cfg.src, 'pages.json');
  }

  /**
   * 扫描文件
   */
  public async scanFiles(): Promise<void> {

    const files = new Map<string, PageFile>();

    function parsePagePath(baseDir: string, filepath: string): string {
      const rel = path.relative(baseDir, filepath);
      return rel.replace(path.extname(rel), '').replaceAll('\\', '/');
    };

    function listFiles(dir: string, options: fg.Options = {}) {
      const { cwd, ignore = [], ...others } = options;
      // fast-glob also use '/' for windows
      const source = PageFile.exts.map(ext => `${fg.convertPathToPattern(dir)}/**/*${ext}`);
      const files = fg.sync(source, {
        cwd: cwd ? fg.convertPathToPattern(cwd) : undefined,
        ignore,
        onlyFiles: true,
        unique: true,
        absolute: true,
        ...others,
      });

      return files;
    }

    // subPackages, 先处理 subPackages 避免重复出现在 pages 里
    for (const dir of this.cfg.subPackageDirs) {
      const root = slash(path.relative(this.cfg.src, dir));

      for (const file of listFiles(dir, { cwd: this.cfg.root, ignore: this.cfg.exclude })) {
        if (files.has(file)) {
          continue; // 跳过重复文件
        }

        debug.debug(`subPackages: ${file}`);

        const pagePath = parsePagePath(path.resolve(this.cfg.root, dir), file);
        let opt: PageFileOption = { filePath: file, pagePath, root };
        for (const hook of this.cfg.hooks) {
          if (hook.parsePageOption) {
            opt = await Promise.resolve(hook.parsePageOption(opt));
          }
        }

        const page = this.files.get(file) || new PageFile(opt);
        files.set(file, page);
      }
    }

    // pages
    for (const file of listFiles(this.cfg.pageDir, { cwd: this.cfg.root, ignore: this.cfg.exclude })) {
      if (files.has(file)) {
        continue; // 跳过重复文件
      }

      debug.debug(`pages: ${file}`);

      const pagePath = parsePagePath(this.cfg.src, file);
      let opt: PageFileOption = { filePath: file, pagePath };
      for (const hook of this.cfg.hooks) {
        if (hook.parsePageOption) {
          opt = await Promise.resolve(hook.parsePageOption(opt));
        }
      }

      const page = this.files.get(file) || new PageFile(opt);
      files.set(file, page);
    }

    this.files = files;
  }

  /**
   * 获取主包页面文件
   */
  public async getMainPageFiles(platform = currentPlatform()): Promise<PageFile[]> {
    let opts: PageFileOption[] = [];
    for (const [, p] of this.files) {
      if (!p.root) { // root 为空，则为 pages
        opts.push({
          filePath: p.file,
          pagePath: p.path,
          root: p.root,
        });
      }
    }

    for (const hook of this.cfg.hooks) {
      if (hook.filterPages) {
        opts = await Promise.resolve(hook.filterPages(platform, opts));
      }
    }

    const files: PageFile[] = [];
    for (const opt of opts) {
      const file = this.files.get(opt.filePath) || new PageFile(opt);
      files.push(file);
    }

    return files;
  }

  /**
   * 获取分包页面文件
   */
  public async getSubPageFiles(platform = currentPlatform()): Promise<PageFile[]> {
    let opts: PageFileOption[] = [];
    for (const [, p] of this.files) {
      if (p.root) { // root 不为空，则为 subPackages
        opts.push({
          filePath: p.file,
          pagePath: p.path,
          root: p.root,
        });
      }
    }

    for (const hook of this.cfg.hooks) {
      if (hook.filterPages) {
        opts = await Promise.resolve(hook.filterPages(platform, opts));
      }
    }

    const files: PageFile[] = [];
    for (const opt of opts) {
      const file = this.files.get(opt.filePath) || new PageFile(opt);
      files.push(file);
    }

    return files;
  }

  /**
   * 更新 pages.json
   *
   * @param filepath 指定更新的文件，空则更新所有文件
   */
  public async updatePagesJSON(filepath?: string): Promise<boolean> {

    if (!(await this.needUpdate(filepath))) {
      return false;
    }

    if (this.updating) {
      return await this.updating;
    }

    // 控制更新频率
    this.updating = this.doUpdate(100).finally(() => {
      setTimeout(() => {
        this.updating = null;
      }, 0);
    });

    return await this.updating;
  }

  /**
   * 根据 platform 生成完整的 pages.json
   */
  public async generatePagesJson(platform = currentPlatform()): Promise<PagesJSON.PagesJson> {
    const pagesJson = (await this.pagesConfigFile.getJson(platform) || {});

    // 合并 pages
    const pages = await this.generatePages(platform);
    if (pages.length > 0) {
      pagesJson.pages = pagesJson.pages || [];
      for (const page of pages) {
        const idx = pagesJson.pages.findIndex(p => p.path === page.path);
        if (idx !== -1) {
          deepAssign(pagesJson.pages[idx], page);
        } else {
          pagesJson.pages.push(page);
        }
      }
    }

    // 合并 subPackages
    const subPackages = await this.generateSubPackages(platform);
    if (subPackages.length > 0) {
      pagesJson.subPackages ??= [];
      for (const sub of subPackages) {
        const idx = pagesJson.subPackages.findIndex(p => p.root === sub.root);
        if (idx !== -1) {
          pagesJson.subPackages[idx].pages ??= [];
          for (const page of (sub.pages || [])) {
            const pidx = pagesJson.subPackages[idx].pages.findIndex(p => p.path === page.path);
            if (pidx !== -1) {
              deepAssign(pagesJson.subPackages[idx].pages[pidx], page);
            } else {
              pagesJson.subPackages[idx].pages.push(page);
            }
          }
        } else {
          pagesJson.subPackages.push(sub);
        }
      }
    }

    // 合并 tabbar
    const subbarItems = await this.generateTabbarItems(platform);
    if (subbarItems.length > 0) {
      pagesJson.tabBar ??= {};
      pagesJson.tabBar.list ??= [];
      for (const item of subbarItems) {
        const idx = pagesJson.tabBar.list.findIndex(tb => tb.pagePath === item.pagePath);
        if (idx !== -1) {
          deepAssign(pagesJson.tabBar.list[idx], item);
        } else {
          pagesJson.tabBar.list.push(item);
        }
      }
    }

    return pagesJson;
  }

  /**
   * 根据 platform 生成 pages
   */
  private async generatePages(platform = currentPlatform()): Promise<PagesJSON.Page[]> {
    const pageFiles = await this.getMainPageFiles(platform);
    return Promise.all(pageFiles.map(async pf => this.transformPage(platform, pf, await pf.getPage(platform))))
      .then(pages => pages.filter(p => !!p));
  }

  /**
   * 根据 platform 生成 subPackages
   */
  private async generateSubPackages(platform = currentPlatform()): Promise<PagesJSON.SubPackage[]> {
    const files = await this.getSubPageFiles(platform);

    const subPackages: Record<string, PagesJSON.SubPackage> = {};
    for (const pf of files) {
      if (!pf.root) {
        continue;
      }
      subPackages[pf.root] = subPackages[pf.root] || { root: pf.root, pages: [] };

      const page = await this.transformPage(platform, pf, await pf.getPage(platform));

      if (page) {
        subPackages[pf.root].pages.push(page);
      }
    }
    return Object.values(subPackages);
  }

  /**
   * 根据 platform 获取 tabbar items
   */
  private async generateTabbarItems(platform = currentPlatform()): Promise<PagesJSON.TabBarItem[]> {
    const files = await this.getMainPageFiles(platform);

    const items: PagesJSON.TabBarItem[] = [];
    for (const pf of files) {
      const item = await pf.getTabbarItem(platform);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  private getPageFileOption(pf: PageFile): PageFileOption {
    return {
      filePath: pf.file,
      pagePath: pf.path,
      root: pf.root || undefined,
    };
  }

  private async transformPage(platform: UniPlatform, pf: PageFile, page: PagesJSON.Page | null): Promise<PagesJSON.Page | null> {
    if (!page) {
      return null;
    }

    const opt = this.getPageFileOption(pf);

    for (const hook of this.cfg.hooks) {
      if (hook.transformPage) {
        page = await hook.transformPage(platform, page, opt);
        if (!page) {
          return null;
        }
      }
    }

    return page;
  }

  private async needUpdate(filepath?: string): Promise<boolean> {

    if (!filepath) { // 未指定文件，则更新所有文件
      await this.scanFiles();
      return true;
    }

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.join(this.cfg.root, filepath);

    // 检测是否合格的动态 pages.json 文件
    if (this.pagesConfigFile.isValid(abspath)) {
      if (abspath !== this.pagesConfigFile.path) {
        this.pagesConfigFile.path = abspath;
      }
      this.pagesConfigFile.fresh();
      return true;
    }

    // 检测是否合格的 page 文件
    if (PageFile.isValid(abspath)) {
      const pageFile = this.files.get(abspath);
      if (pageFile) { // 文件存在
        pageFile.fresh();
        return true;
      } else { // 文件不存在，扫描全局文件
        await this.scanFiles();
        return true;
      }
    }

    // 既不是 page config 文件 又不是 page 文件
    debug.info(`文件 ${filepath} 不是 pages.json 相关文件，跳过更新。`);
    return false;
  }

  private async doUpdate(delay = 100) {

    await sleep(delay); // 控制更新频率

    if (this.files.size === 0) {
      await this.scanFiles(); // 避免每次都扫描全局
    }

    this.checkJsonFileSync();
    const { indent, eof, content } = await this.detectJsonFile(true);
    const platforms = await this.getPlatforms();

    const jsons = {} as Record<UniPlatform, PagesJSON.PagesJson>;

    for (const platform of platforms) {
      jsons[platform] = await this.generatePagesJson(platform);
    }

    const rawJson = stringifyPagesJsons(jsons, indent) + eof;

    if (content === rawJson) {
      debug.info('pages.json 无改动，跳过更新。');
      return false;
    }

    await fs.promises.writeFile(this.jsonFilePath, rawJson);

    if (this.cfg.dts) {
      await writeDeclaration(jsons, this.cfg.dts as string);
    }

    debug.info('pages.json 更新成功。');

    return true;
  }

  private getRunningPlatforms(): UniPlatform[] {

    const readCacheFile = (file: string): Partial<Record<UniPlatform, number>>[] => {
      try {
        const exist = fs.existsSync(file);
        if (!exist) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          return [];
        }

        const json = fs.readFileSync(file, 'utf-8');

        return JSON.parse(json);
      } catch {
        return [];
      }
    };

    const cacheFile = path.join(this.cfg.cacheDir, 'running-platforms.json');
    const list = readCacheFile(cacheFile);

    let res: Partial<Record<UniPlatform, number>> = {};

    if (list.length > 0) {
      res = { ...list[0] };
    }

    if (list.length >= 2) {
      for (const [oldKey, oldVal] of Object.entries(list[1])) {
        const newVal = res[oldKey as UniPlatform];
        if (newVal && newVal === oldVal) {
          delete res[oldKey as UniPlatform]; // 如果旧的缓存时间和新的缓存时间一致，则删除旧的缓存
        }
      }
    }

    const now = new Date();
    debug.debug(`更新 running platforms [${currentPlatform()}], 时间：${now.toLocaleString()}`);

    res[currentPlatform()] = now.getTime(); // 更新当前平台运行时间

    list.unshift(res);

    fs.writeFileSync(cacheFile, JSON.stringify(list.slice(0, 3), null, this.cfg.indent));

    return [...Object.keys(res)].filter(Boolean) as UniPlatform[];
  }

  public async getPlatforms(): Promise<UniPlatform[]> {
    const platforms = new Set<UniPlatform>(this.cfg.platform);

    const jsonPlatforms = await this.pagesConfigFile.getPlatforms();
    jsonPlatforms.forEach(platform => platforms.add(platform));

    for (const [, file] of this.files) {
      const fp = await file.getPlatforms();
      fp.forEach(platform => platforms.add(platform));
    }

    const runningPlatforms = this.getRunningPlatforms();
    runningPlatforms.forEach(platform => platforms.add(platform));

    return Array.from(platforms).sort();
  }

  /**
   * 检查静态文件
   */
  public checkJsonFileSync(): boolean {
    return checkFileSync({
      path: this.jsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, this.cfg.indent),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 读取 json 文件内容，并检测文件信息（代码缩进、末端换行）
   */
  public async detectJsonFile(forceUpdate = false): Promise<JsonFileInfo> {
    if (!forceUpdate && this.jsonFileInfo) {
      return this.jsonFileInfo;
    }

    const detect = async () => {
      const res = {
        platforms: new Set<UniPlatform>([currentPlatform()]),
        indent: this.cfg.indent,
        eof: '\n',
        content: '',
      };

      const content = await fs.promises.readFile(this.jsonFilePath, { encoding: 'utf-8' }).catch(() => '');
      if (!content) {
        return res;
      }

      res.content = content;

      try {
        res.indent = detectIndent(content);

        const lastChar = content[content.length - 1];
        if (lastChar === '\n') {
          res.eof = '\n';
        } else {
          res.eof = '';
        }

        return res;

      } catch {
        return res;
      }
    };

    this.jsonFileInfo = await detect();

    return this.jsonFileInfo;
  }

  /**
   * 监听文件
   */
  public watch() {

    const paths: string[] = [];

    for (const dir of [this.cfg.pageDir, ...this.cfg.subPackageDirs]) {
      for (const ext of PageFile.exts) {
        paths.push(path.join(dir, `**/*${ext}`));
      }
    }

    const watcher = chokidar.watch([
      ...paths,
      ...this.cfg.pagesJsonFilePaths,
    ], {
      ignored: this.cfg.exclude,
    });

    setTimeout(() => {
      watcher.on('add', async (file) => {
        debug.debug(`新增文件: ${file}`);
        await this.updatePagesJSON(file);
      });

      watcher.on('change', async (file) => {
        debug.debug(`修改文件: ${file}`);
        await this.updatePagesJSON(file);
      });

      watcher.on('unlink', async (file) => {
        debug.debug(`删除文件: ${file}`);
        await this.updatePagesJSON();
      });
    }, 100); // 延迟 100ms，避免第一次扫描时触发更新
  }

}
