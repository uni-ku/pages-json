import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { SFCDescriptor, SFCScriptBlock } from '@vue/compiler-sfc';
import type { ConditionalObject } from './condition';
import type { DeepPartial, MaybePromise } from './types';
import fs from 'node:fs/promises';
import * as t from '@babel/types';
import { parse as VueParser } from '@vue/compiler-sfc';
import { babelParse, isCallOf } from 'ast-kit';
import { Conditional, getSupportedPlatforms, isConditional, resolveToObject, unwrapConditional } from './condition';
import { generate as babelGenerate } from './utils/babel';
import { debug } from './utils/debug';
import { deepCopy } from './utils/object';
import { parseCode } from './utils/parser';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

export interface DefinePageFuncArgs {
  define: (meta: UserPageMeta) => Conditional<UserPageMeta>;
  platform: UniPlatform;
}

export function definePage(arg: UserPageMeta | ((arg: DefinePageFuncArgs) => MaybePromise<UserPageMeta | Conditional<UserPageMeta>>)) { }

function define(meta: UserPageMeta): Conditional<UserPageMeta> {
  return new Conditional(meta);
}

export interface UserTabBarItem extends DeepPartial<PagesJSON.TabBarItem> {
  /**
   * 配置tabbar路径
   * @deprecated 无效，将会根据文件路径自动生成
   */
  pagePath?: string;

  /**
   * 排序，数值越小越靠前
   */
  index?: number;
};

export interface UserPageMeta extends DeepPartial<PagesJSON.Page> {

  /**
   * 标识 page 类型
   */
  type?: 'page' | 'home';

  /**
   * 配置页面路径
   * @deprecated 无效，将会根据文件路径自动生成
   */
  path?: string;

  /**
   * 配置 tabbar 属性
   */
  tabbar?: UserTabBarItem;
}

export const PAGE_TYPE_KEY = Symbol.for('page_type');
export const TABBAR_INDEX_KEY = Symbol.for('tabbar_index');

export interface MacroInfo {
  imports: t.ImportDeclaration[];
  ast: t.CallExpression;
  code: string; // definePage 的参数的代码
  preparedCode: string; // 预处理后的代码，可直接用于解析。
}

export interface PageFileOption {
  /** 文件路径 */
  filePath: string;
  /** 页面路径，对应 pages.json 中的 path */
  pagePath: string;
  /** subPackages 中的 root，为空则非subPackage */
  root?: string;
  /**
   * definePage 解析后的元数据（按当前 platform 计算）
   */
  definePageMeta?: UserPageMeta;
}

export class PageFile {
  /** 文件的绝对路径 */
  public readonly file: string;

  /** 对应 pages.json 中的 path */
  public readonly path: string;

  /** 对应 pages.json 中的 subPackages 中的 root */
  public readonly root: string;

  private changed = true;

  /** 上次的 definePage 参数的代码 */
  private lastCode: string = '';

  /** platform => page meta */
  private metas = new Map<UniPlatform, UserPageMeta>();

  private condition: ConditionalObject<UserPageMeta> | undefined;

  private content: string = '';
  private sfc?: SFCDescriptor;
  private macro?: MacroInfo;

  /**
   * 页面文件的扩展名
   */
  public static readonly exts = ['.vue', '.nvue', '.uvue'];

  public static isValid(filepath: string): boolean {
    if (!PageFile.exts.some(ext => filepath.endsWith(ext))) {
      return false;
    }
    return true;
  }

  constructor({ filePath, pagePath, root }: PageFileOption) {
    this.file = filePath;
    this.path = pagePath.replaceAll('\\', '/');
    this.root = root || '';
  }

  public async getPage(platform = currentPlatform(), forceRead = false): Promise<PagesJSON.Page> {

    const { tabbar: _, path, type, ...others } = await this.getPageMeta(platform, forceRead) || {};

    return deepCopy({
      path: path || this.path,
      ...others,
      [PAGE_TYPE_KEY]: type || 'page',
    }) as PagesJSON.Page;
  }

  public async getTabbarItem(platform = currentPlatform(), forceRead = false): Promise<PagesJSON.TabBarItem | undefined> {

    const { tabbar } = await this.getPageMeta(platform, forceRead) || {};
    if (tabbar === undefined) {
      return;
    }

    const { index, pagePath, ...others } = tabbar;

    return deepCopy({
      pagePath: pagePath || this.path,
      ...others,
      [TABBAR_INDEX_KEY]: index,
    });
  }

  public hasChanged() {
    return this.changed;
  }

  /**
   * 解析文件内容
   * @param content 指定文件内容，为空则读取文件
   */
  public async parse(content?: string): Promise<void> {
    // content
    if (content !== undefined) {
      this.content = content;
    } else {
      this.content = await fs.readFile(this.file, { encoding: 'utf-8' }).catch(() => '');
    }

    // sfc
    this.sfc = (
      VueParser(this.content, {
        pad: 'space',
        filename: this.file,
      }).descriptor
      // for @vue/compiler-sfc ^2.7
      || (VueParser as any)({
        source: this.content,
        filename: this.file,
      })
    );

    const findMacro = (sfcScript: SFCScriptBlock | null): { imports: t.ImportDeclaration[]; macro: t.CallExpression } | undefined => {
      if (!sfcScript) {
        return;
      }

      const ast = babelParse(sfcScript.content, sfcScript.lang || 'js', {
        plugins: [['importAttributes', { deprecatedAssertSyntax: true }]],
      });

      // macro
      let macro: t.CallExpression | undefined;

      for (const stmt of ast.body) {
        let node: t.Node = stmt;
        if (stmt.type === 'ExpressionStatement') {
          node = stmt.expression;
        }

        if (isCallOf(node, 'definePage')) {
          macro = node;
          break;
        }
      }

      if (!macro) {
        return;
      }

      // imports
      const imports: t.ImportDeclaration[] = [];
      for (const stmt of ast.body) {
        if (t.isImportDeclaration(stmt)) {
          imports.push(stmt);
        }
      }

      return {
        imports,
        macro,
      };
    };

    let res = findMacro(this.sfc.scriptSetup);

    if (!res) {
      res = findMacro(this.sfc.script);
    }

    if (!res) {
      return;
    }

    // 提取 macro function 内的第一个参数
    const [arg1] = res.macro.arguments;

    // 检查 macro 的参数是否正确
    if (arg1 && !t.isFunctionExpression(arg1) && !t.isArrowFunctionExpression(arg1) && !t.isObjectExpression(arg1)) {
      debug.warn(`definePage() 参数仅支持函数或对象：${this.file}`);
      return;
    }

    // 缓存 macro code，避免每次生成代码
    const code = babelGenerate(arg1).code;
    const preparedCode = ([
      ...res.imports.map(imp => babelGenerate(imp).code),
      `export default ${code}`,
    ]).join('\n');

    this.macro = {
      imports: res.imports,
      ast: res.macro,
      code,
      preparedCode,
    };

    this.changed = this.lastCode !== code;
    if (this.changed) {
      // 如果有更改，则清空 metas
      this.metas.clear();
      this.condition = undefined;
    }

    this.lastCode = code;
  }

  private async parsePageMeta(platform: UniPlatform = currentPlatform()): Promise<void> {

    if (!this.macro) {
      this.metas.delete(platform);
      return;
    }

    const parsed = await parseCode({
      code: this.macro.preparedCode,
      filename: this.file,
      env: {
        UNI_PLATFORM: platform,
      },
    });

    const res: UserPageMeta | Conditional<UserPageMeta> = typeof parsed === 'function'
      ? await Promise.resolve(parsed({ define, platform } as DefinePageFuncArgs))
      : await Promise.resolve(parsed);

    if (isConditional(res)) {
      this.condition = unwrapConditional(res);
      this.metas.clear();
    } else {
      this.condition = undefined;
      this.metas.set(platform, res);
    }

    this.changed = false; // 已经更新过 page meta, 可以将 changed 标记置为 false
  }

  public async getPageMeta(platform = currentPlatform(), forceRead = false): Promise<UserPageMeta | undefined> {

    if (forceRead || !this.content) {
      await this.parse();
    }
    if (!this.condition && !this.metas.has(platform)) {
      await this.parsePageMeta(platform);
    }

    if (this.condition !== undefined) {
      return resolveToObject(this.condition, platform);
    }

    return this.metas.get(platform);
  }

  public async getMacroInfo(forceRead = false): Promise<MacroInfo | undefined> {
    if (forceRead || !this.content) {
      await this.parse();
    }

    return this.macro;
  }

  public async getPlatforms(): Promise<UniPlatform[]> {
    await this.getPage(); // 保证读取了文件
    if (this.condition) {
      return getSupportedPlatforms(this.condition);
    }
    return [];
  }

  /**
   * 清除缓存
   */
  public fresh() {
    this.content = '';
    this.changed = true;
    this.condition = undefined;
    this.metas.clear();
  }

}

export function getPageType(page: PagesJSON.Page): 'page' | 'home' {
  return page[PAGE_TYPE_KEY as any] || 'page';
}

export function getTabbarIndex(tabbarItem: PagesJSON.TabBarItem): number {
  return tabbarItem[TABBAR_INDEX_KEY as any] || 0;
}
