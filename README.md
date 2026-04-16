# @uni-ku/pages-json

使用 TypeScript / JavaScript 动态生成 uni-app 的 pages.json 配置文件。

## ✨ 特性

- 🚀 **条件编译支持** - 根据平台动态生成配置
- 🔧 **类型安全** - 完整的 TypeScript 类型提示和约束
- 📝 **JavaScript 对象** - 支持 JS Object 配置方式
- ⚡ **函数式编程** - 支持同步和异步函数生成配置
- 🔗 **模块导入** - 支持从外部导入变量和函数
- 🎯 **智能路径生成** - 自动根据文件路径生成页面路径

## 📦 安装

```shell
pnpm i -D @uni-ku/pages-json
```

## ⚙️ 配置

### Vite 配置

```ts
import uni from '@dcloudio/vite-plugin-uni';
import { hookUniPlatform } from '@uni-ku/pages-json/hooks';
import pagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    pagesJson({
      hooks: [hookUniPlatform], // 支持 vite-plugin-uni-platform
    }),
    uni(), // 必须放在 pagesJson() 之后
  ],
});
```

### 类型声明配置

在 `tsconfig.json` 中添加类型声明：

```json
{
  "compilerOptions": {
    "types": ["@uni-ku/pages-json/client"]
  }
}
```

### 详细配置选项

```ts
export interface UserConfig {
  /**
   * 项目根目录
   * @default process.env.UNI_CLI_CONTEXT || process.cwd()
   */
  root?: string;

  /**
   * 源码目录
   * @default process.env.UNI_INPUT_DIR || path.resolve(root, 'src') || root
   */
  src?: string;

  /**
   * 页面目录路径 （基于源码目录的相对路径 / 绝对路径）
   * @default 'pages'
   */
  pageDir?: string;

  /**
   * 子包目录路径数组 （基于源码目录的相对路径 / 绝对路径）
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除的文件模式
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  exclude?: string[];

  /**
   * TS 声明文件路径  （基于源码目录的相对路径 / 绝对路径）
   * false 则取消生成
   * @default "pages.d.ts"
   */
  dts?: string | boolean;

  /**
   * 调试模式
   * @default false
   */
  debug?: boolean | 'info' | 'error' | 'debug' | 'warn';

  /**
   * 钩子函数数组
   */
  hooks?: ConfigHook[];

  /**
   * 缓存目录
   * @default 'node_modules/.cache/@uni-ku/pages-json'
   */
  cacheDir?: string;

  /**
   * 指定需要的平台，避免动态条件编译（方式一）造成的 pages.json 变动
   */
  platform?: BuiltInPlatform | BuiltInPlatform[];

  /**
   * pages.json 格式化缩进，默认使用 4 个空格缩进
   */
  indent?: string | number;
}

export interface ConfigHook {
  /**
   * 获取页面路径
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
  transformPage?: (platform: UniPlatform, page: Page, opt: PageFileOption) => MaybePromise<Page | null>;
}
```

## 📄 动态配置文件

项目根目录或源码目录下创建 `pages.json.(ts|mts|cts|js|cjs|mjs)` 文件：

```ts
import { defineConfig } from '@uni-ku/pages-json';

export default defineConfig({
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: 'uni-app',
    navigationBarBackgroundColor: '#F8F8F8',
    backgroundColor: '#F8F8F8',
  },
  pages: [
    {
      path: 'pages/index/index',
      style: {
        navigationBarTitleText: '首页',
      },
    },
  ],
});
```
## 🎯 Vue SFC 中的 definePage 宏

### JS 对象

```vue
<script setup lang="ts">
definePage({
  style: {
    navigationBarTitleText: '页面标题',
  },
  middlewares: ['auth'],
});
</script>
```

### 函数式

```vue
<script setup lang="ts">
definePage(() => {
  const title = '动态标题';

  return {
    style: {
      navigationBarTitleText: title,
    },
    middlewares: ['auth'],
  };
});
</script>
```

### 异步函数

```vue
<script setup lang="ts">
definePage(async () => {
  const title = await fetchTitle();

  return {
    style: {
      navigationBarTitleText: title,
    },
  };
});
</script>
```

### 外部模块导入

```vue
<script setup lang="ts">
import { parse as parseYAML } from 'yaml';

definePage(() => {
  const config = `
style:
  navigationBarTitleText: "YAML 配置"
middlewares:
  - auth
  - logger
`;

  return parseYAML(config);
});
</script>
```

### 条件编译

#### 方式一：动态环境变量判断

直接根据环境变量返回不同的对象。

可在配置里手动指定全部平台，避免因为运行时 `platform` 不同导致 `pages.json` 变动。

> **注意：使用第三方库判断环境可能会判断错误。因为部分第三方库初始化时，变量值已经固定，后期环境变量修改无法跟着变更**
```vue
<script setup lang="ts">
definePage(({ platform }) => {
  // 使用注入的 platform 变量
  const title = platform === 'h5' ? 'H5 环境' : '非 H5 环境';
  // 使用 process.env.UNI_PLATFORM
  const bgColor = process.env.UNI_PLATFORM === 'h5' ? 'white' : 'black';

  if (platform === 'mp-weixin') {
    return null; // mp-weixin 环境下不生成该页面 json
  }

  return {
    style: {
      navigationBarTitleText: title,
      backgroundColor: bgColor,
    },
  };
});
</script>
```

#### 方式二：条件编译函数

```vue
<script setup lang="ts">
definePage(({ define }) => {
  return define({
    style: {
      navigationBarTitleText: '基础配置',
    },
  })
    .ifdef('mp-weixin', {
      style: {
        navigationBarBackgroundColor: '#07C160',
      },
    })
    .ifndef('h5', {
      style: {
        enablePullDownRefresh: true,
      },
    });
});
</script>
```

## 🔧 高级功能

### 获取当前平台配置

- 直接通过 `import` 引入 `pages.json` （uniapp 会处理成当前平台的 json 内容）
- 可通过虚拟模块引入：
```ts
import pagesJson from 'virtual:pages-json';
console.log(pagesJson);
```

### 类型导入

```ts
import type { Page, PagesJson, SubPackage } from '@uni-ku/pages-json/types';
```

### 与 vite-plugin-uni-platform 集成

```ts
import { hookUniPlatform } from '@uni-ku/pages-json/hooks';

export default defineConfig({
  plugins: [
    pagesJson({
      hooks: [hookUniPlatform],
    }),
  ],
});
```

## ⚠️ 注意事项

1. **作用域限制**：`definePage` 宏与 SFC 不同域，无法访问 SFC 内部变量
2. **路径自动生成**：页面路径会根据文件路径自动生成
3. **单一使用**：每个页面只能使用一次 `definePage`
4. **平台判断**：避免使用可能被缓存的第三方库进行平台判断

## 📚 示例项目

查看 [playground 示例](./playground/src/pages/define-page/) 了解更多使用方式。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
