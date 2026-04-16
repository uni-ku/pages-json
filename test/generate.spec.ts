import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringifyPagesJsons } from '../src/condition';
import { resolveConfig } from '../src/config';
import { Context } from '../src/context';

const cfg = resolveConfig({
  root: path.resolve(__dirname, '../playground'),
  pageDir: 'pages',
  subPackageDirs: ['pages-sub'],
  platform: ['h5', 'mp-weixin', 'mp-alipay'],
});

const ctx = new Context(cfg);

describe('generate', async () => {

  it('pagesJson snapshot', async () => {

    await ctx.scanFiles();

    const platforms = await ctx.getPlatforms();

    const jsons = {} as any;

    for (const platform of platforms) {
      jsons[platform] = await ctx.generatePagesJson(platform);
    }

    const raw = stringifyPagesJsons(jsons, 2);

    expect(raw).toMatchInlineSnapshot(`
      "{
        "globalStyle": {
          "navigationBarTextStyle": "black",
          // #ifdef H5
          "navigationBarTitleText": "uni-app H5",
          // #endif
          // #ifdef MP-ALIPAY || MP-WEIXIN
          "navigationBarTitleText": "uni-app other",
          // #endif
          "navigationBarBackgroundColor": "#F8F8F8",
          "backgroundColor": "#F8F8F8"
        },
        "pages": [
          {
            "path": "pages/index/index",
            "style": {
              "navigationBarTitleText": "uni-app",
              "animationType": "pop-in"
            }
          },
          // #ifdef H5 || MP-ALIPAY
          {
            "path": "pages/define-page/async-function",
            "style": {
              "navigationBarTitleText": "hello world from async"
            }
          },
          // #endif
          {
            "path": "pages/define-page/function",
            "style": {
              "navigationBarTitleText": "hello world",
              // #ifdef MP-ALIPAY
              "backgroundColor": "#fff"
              // #endif
            }
          },
          {
            "path": "pages/define-page/nested-function",
            "style": {
              "navigationBarTitleText": "hello world"
            }
          },
          {
            "path": "pages/define-page/object",
            "style": {
              "navigationBarTitleText": "hello world"
            }
          },
          {
            "path": "pages/define-page/option-api",
            "style": {
              "navigationBarTitleText": "Option API 内使用 definePage"
            }
          },
          {
            "path": "pages/define-page/yaml",
            "style": {
              "navigationBarTitleText": "yaml test"
            }
          }
        ],
        "subPackages": [
          {
            "root": "pages-sub",
            "plugins": {
              "uni-id-pages": {
                "version": "1.0.0",
                "provider": "https://service-1.pages.dev"
              }
            },
            "pages": [
              {
                "path": "index"
              },
              {
                "path": "about/index"
              },
              {
                "path": "about/your"
              }
            ]
          }
        ],
        "tabBar": {
          "list": [
            {
              "pagePath": "pages/define-page/object"
            }
          ]
        }
      }"
      `);
  });

  it('transformPage hook', async () => {
    const hookedCtx = new Context(resolveConfig({
      root: path.resolve(__dirname, '../playground'),
      pageDir: 'pages',
      subPackageDirs: ['pages-sub'],
      platform: ['h5'],
      hooks: [
        {
          transformPage(platform, page, opt) {
            return {
              ...page,
              style: {
                ...page.style,
                navigationBarBackgroundColor: opt.root ? '#111111' : '#222222',
                navigationBarTextStyle: platform === 'h5' ? 'white' : 'black',
              },
            };
          },
        },
      ],
    }));

    await hookedCtx.scanFiles();

    const pagesJson = await hookedCtx.generatePagesJson('h5');
    const mainPage = pagesJson.pages?.find(page => page.path === 'pages/index/index');
    const subPage = pagesJson.subPackages
      ?.find(subPackage => subPackage.root === 'pages-sub')
      ?.pages
      .find(page => page.path === 'index');

    expect(mainPage).toMatchObject({
      style: {
        navigationBarBackgroundColor: '#222222',
        navigationBarTextStyle: 'white',
      },
    });

    expect(subPage).toMatchObject({
      style: {
        navigationBarBackgroundColor: '#111111',
        navigationBarTextStyle: 'white',
      },
    });
  });
});
