# 竞品分析看板 — 开发契约 (CONTRACT)

本文件是后端与前端并行开发的唯一对齐基准。所有模块必须严格遵守此处定义的目录结构、数据契约与 API 契约。

## 1. 项目目标

一个「竞品分析栏目」Web 应用:输入 站点 + 我司 ASIN + 最多 3 个竞品 ASIN,自动完成:

1. **数据拉取层**(经 LinkFox Agent API 调用卖家精灵/亚马逊前台工具):
   - `@卖家精灵-查竞品` → 核心市场指标(销量/销售额/BSR/价格/利润/FBA/评分/徽章/尺寸重量/卖家等 57 字段)
   - `@亚马逊前端-商品详情` → 标题/主图/套图/五点描述/规格/A+/视频/相关商品/经常一起购买
   - `@亚马逊-商品评论` → 每星级评论原文(单 ASIN 一次任务)
2. **LLM 分析层**(智谱 GLM, OpenAI 兼容):
   - 标题与五点 Alexa/Rufus 分析(每产品:标题分析 + 五点分析,各含 优点/缺点/改进)
   - VOC 聚类(好评点 top3 / 差评点 top3 / 未被满足需求,每条带证据评论引用)
   - 差异化策略建议(我司 vs 竞品)
3. **前端看板**(风格对齐《边桌床头柜竞品分析看板_增强版》示例截图)。

诚实原则:拿不到的数据必须写明数据状态(如"Amazon评论模块要求账户验证,无法输出真实评论聚类"),**绝不编造**。

## 2. 目录结构

```
竞品分析看板/
├── .env                    # 密钥(已存在,勿覆盖): LINKFOXAGENT_*, LLM_*
├── .gitignore
├── CONTRACT.md             # 本文件
├── README.md
├── requirements.txt        # fastapi, uvicorn (仅此二者;HTTP 用标准库 urllib)
├── run.ps1                 # 一键启动脚本(设 PATH/PYTHONUTF8,读 .env,uvicorn 启动)
├── backend/
│   ├── __init__.py
│   ├── config.py           # .env 加载(手写解析,不依赖 python-dotenv)
│   ├── linkfox_client.py   # LinkFox 提交/轮询
│   ├── datasources.py      # 三个工具任务的提交+解析 → 规范化结构
│   ├── llm.py              # OpenAI 兼容 chat 客户端(urllib), JSON 模式输出
│   ├── analysis.py         # LLM 分析 prompts + 结果解析
│   ├── pipeline.py         # 编排:拉取→分析→组装 dashboard.json;线程后台执行;进度上报
│   ├── store.py            # data/ 持久化(runs + cache)
│   └── app.py              # FastAPI 实例 + 路由 + 静态托管 frontend/
├── data/
│   ├── cache/              # 原始工具结果缓存: {tool}_{market}_{asins_hash}.json
│   └── runs/<runId>/       # status.json + dashboard.json + raw/*.json
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## 3. 运行环境

- Windows 11 + PowerShell 5.1;`python` 需先把 Machine+User PATH 拼回来(run.ps1 内处理)。
- 全程 UTF-8:`$env:PYTHONUTF8="1"`;Python 文件读写一律 `encoding="utf-8"`。
- 端口:**8916**。启动后 `http://127.0.0.1:8916/` 即看板。
- `.env` 已存在于项目根目录(含真实密钥),config.py 启动时手动解析注入 os.environ(不覆盖已存在的进程变量)。

## 4. LinkFox Agent API 协议(已实测验证)

- 提交任务:`POST {LINKFOXAGENT_BASE_URL}/chat/saveMessageForApi`,body `{"text": "<任务文本>"}`
- 轮询结果:`POST {LINKFOXAGENT_BASE_URL}/chat/getMessageForApi`,body `{"id": "<messageId>"}`
- 请求头:`Authorization: <LINKFOXAGENT_API_KEY>`(**裸 JWT,不带 Bearer 前缀**),`Content-Type: application/json`
- 提交响应:`{"messageId": "...", "chatId": "...", "status": "ready", ...}`
- 轮询响应:`{"status": "ready|running|finished|error|cancel", "progress": "n/m 步骤名", "reflection": "总结文本", "shareUrl": "...", "results": [{"name": "...", "type": "html|json", "content": "...", "toolName": "..."}]}`
- 终态:`finished` / `error` / `cancel`。任务一般 1~5 分钟。轮询间隔 5s,单任务超时 600s。
- `results[].type == "json"` 时 `content` 是 JSON 字符串,内层结构:`{"columns": [{field,title,...}], "products"|"data"|"items": [...], "total": n, "type": "productWorkbenches|...", "message": "..."}`

### 任务文本模板(实测有效)

- 查竞品(4 ASIN 一次批量):
  `@卖家精灵-查竞品 在美国站,asin为 B0FY5PZCXQ,B0CQJZ8XQG,B0DMN566D4,B0FKT9HHN6 的商品数据,返回全部字段`
- 商品详情(批量):
  `@亚马逊前端-商品详情 获取亚马逊美国站,asin为:B0FY5PZCXQ、B0CQJZ8XQG 的数据,同时返回相关商品列表(relatedProducts=true)和经常一起购买的商品(boughtTogether=true)`
- 商品评论(单 ASIN 一次任务):
  `@亚马逊-商品评论 亚马逊美国站,asin为B0FY5PZCXQ,每个星级各20条,评论排序方式为最新评论,评论者类型为所有评论`
- 站点映射:US=美国站, UK=英国站, DE=德国站, FR=法国站, JP=日本站, CA=加拿大站 …(前端下拉先只放这 6 个)

### 已完成/进行中的真实任务(fixture,解析器必须以其真实返回结构为准)

| 用途 | messageId | 状态 |
|---|---|---|
| 查竞品 4 ASIN | `dRd93JhSoiqqjEK7MJcGej` | finished,已落盘 `.openclaw/skills/linkfoxagent/scripts/output/202607161759/2_查询指定ASIN数据.json` |
| 商品详情 4 ASIN | `obtNKJoSPrxdKequtgKyNd` | 已提交,轮询取结果 |
| 评论 B0FY5PZCXQ | `8whiL7Ww2njDzB4sV6V8D5` | 已提交 |
| 评论 B0CQJZ8XQG | `vpWphYQqR4HC7da5YwwhaN` | 已提交 |
| 评论 B0DMN566D4 | `7Usepmne7phMPyAJ8gtFBM` | 已提交 |
| 评论 B0FKT9HHN6 | `yoJTgcRqAmMEYgorxdtg4T` | 已提交 |

真实 ASIN(边桌床头柜品类):我司 `B0FY5PZCXQ` (AMADA HOMEFURNISHING);竞品 `B0CQJZ8XQG` (SICOTAS), `B0DMN566D4` (mopio), `B0FKT9HHN6` (SICOTAS oversized)。

## 5. LLM 协议(智谱 GLM)

- `POST {LLM_BASE_URL}chat/completions`,`Authorization: Bearer {LLM_API_KEY}`,model=`{LLM_MODEL}`(glm-5.2)。
- 请求 `response_format: {"type": "json_object"}` 要求 JSON 输出;仍需容错:剥 ```json 围栏、找第一个 { 到最后一个 } 再 json.loads。
- 失败重试 2 次;彻底失败时该分析块置 `null` 并在 `notes` 里写明,不得编造。

## 6. Dashboard JSON 契约(前后端唯一接口)

`GET /api/runs/{runId}/dashboard` 返回:

```jsonc
{
  "runId": "run_20260717_0130",
  "market": "US",
  "createdAt": "2026-07-17T01:30:00",
  "myAsin": "B0FY5PZCXQ",
  "title": "边桌/床头柜竞品分析看板",
  "notes": ["整体备注,如某数据源失败说明"],
  "products": [            // 我司在前,竞品按输入顺序;每个产品:
    {
      "asin": "B0FY5PZCXQ",
      "role": "my",                     // "my" | "competitor"
      "roleLabel": "我司产品",           // "我司产品" | "直接竞对1/2/3"
      "brand": "AMADA HOMEFURNISHING",
      "title": "Amada Fluted Nightstands ...",
      "imageUrl": "https://...jpg",
      "productUrl": "https://www.amazon.com/dp/B0FY5PZCXQ",
      "brandUrl": "https://www.amazon.com/stores/...",   // 可为 null
      "videoUrl": null,                  // 可为 null
      "metrics": {                       // 全部来自查竞品,取不到为 null
        "monthlySalesUnits": 53, "monthlySalesRevenue": 4530.97,
        "bsrCategory": "Home & Kitchen", "bsr": 689057,
        "subCategory": "Nightstands", "subBsr": 1103,
        "price": 85.49, "averagePrice": 89.99, "profit": 55.16, "fba": 25.51,
        "rating": 4.6, "ratings": 14, "ratingsRate": 1.89, "ratingsGrowth": 1,
        "monthlySalesUnitsGrowthRate": 60.0, "bsrGrowthRate": -32.56,
        "variationNum": 3, "parentAsin": "B0FY5R28DD",
        "availableDate": "2025-10-29", "fulfillment": "FBM",
        "sellerName": "Bestqi Ergonomic", "sellerId": "A1GPOKKOFRQBRD", "sellerNation": "US",
        "sellerUrl": "https://www.amazon.com/sp?seller=A1GPOKKOFRQBRD",
        "listingQualityScore": 100.0, "weight": "25.35 pounds",
        "dimension": "15.6 x 17.6 x 22.8 inches", "packageDimensions": null, "packageWeight": null,
        "sku": "Color: Natural Oak | Number of Items: 1",
        "nodeLabelPath": "Home & Kitchen:Furniture:Bedroom Furniture:Nightstands",
        "badges": {"bestSeller":"N","amazonChoice":"N","newRelease":"N","ebc":"Y","video":"Y"}
      },
      "detail": {                        // 来自商品详情;整块可为 null(拉取失败)
        "bullets": ["五点1", "..."],
        "images": ["url1", "..."],       // 套图
        "videoUrl": null,
        "aplus": true,
        "specs": {"k":"v"},
        "recommended": [{"asin":"...","imageUrl":"...","title":"..."}],  // 相关商品
        "boughtTogether": [{"asin":"...","imageUrl":"...","title":"..."}],
        "modules": {"coupon": null, "deal": null, "bsAc": null}  // 前台模块状态文本或 null
      },
      "reviews": {
        "status": "ok",                  // "ok" | "unavailable"
        "note": "",                      // unavailable 时写明原因(诚实)
        "count": 13, "lowStarCount": 0,
        "items": [{"star":5.0,"title":"...","date":"June 25, 2025","content":"...","verified":true}]
      },
      "analysis": {                      // LLM;整块或子块可为 null
        "titleAnalysis":   {"pros":["..."],"cons":["..."],"advice":"..."},
        "bulletsAnalysis": {"pros":["..."],"cons":["..."],"advice":"..."},
        "voc": {
          "status": "ok",                // "ok" | "unavailable"
          "note": "",
          "positiveTop": [{"point":"安装(证据: xxx)","evidence":["评论摘录1"]}],
          "negativeTop": [{"point":"...","evidence":["..."]}],
          "unmetNeeds":  [{"point":"...","evidence":["..."]}]
        },
        "strategy": "高销量竞品用AC标+高评论承接自然/广告流量;我司应先修Listing转化,再投充电/小空间/USB-C长尾词"
      }
    }
  ],
  "crossAnalysis": {                     // LLM 跨产品综合(可为 null)
    "summary": "一段综合对比结论",
    "actions": ["行动建议1", "..."]
  },
  "fieldMatrix": {                       // 长对比表:行定义 + 每产品取值(由后端组装,前端纯渲染)
    "groups": [
      {
        "name": "链接基本信息",
        "rows": [
          {"label": "产品图片", "type": "image", "values": ["url","url","url","url"]},
          {"label": "产品链接", "type": "link",  "values": ["url", ...]},
          {"label": "品牌", "type": "text", "values": ["AMADA", ...]},
          // type: text | number | money | percent | link | image | images | badge | status
          // "status" 值渲染为灰色斜体说明(数据状态,如"需Keepa接口确认")
        ]
      }
    ]
  },
  "sopMatrix": [                         // 静态 SOP 定义表(类别/属性/SOP说明)
    {"category":"链接基本信息","attr":"产品图片","sop":"Excel内嵌缩略图;HTML可点击打开大图。"}
  ]
}
```

**字段矩阵行分组(对齐示例图,按此顺序)**:
1. 链接基本信息:产品图片、产品链接、品牌、ASIN、变体数(+SKU)、评论数、星级、上架时间、卖家(店铺)名称、店铺链接、卖家链接
2. 市场表现:售价、成交价(averagePrice 代理)、大类BSR、小类BSR、月销量、月销售额、月销量增长率、BSR增长率、留评率、利润/FBA费、Listing质量分
3. 产品与物流:类目路径、商品尺寸、重量、包装尺寸、包装重量、配送方式、变体数
4. 前台模块状态:A+页面、视频、Coupon、Deal、BS/AC标、Badge(status 型诚实标注)
5. 五点与卖点:五点描述原文(每产品一格,列表)、标题/五点分析摘要
6. VOC:好评点top3、差评点top3、未被满足需求(带证据;unavailable 时 status 文案)
7. 媒体与推荐:套图(images 缩略图网格)、视频入口(link)、Amazon推荐商品(推荐ASIN小卡网格)、经常一起购买
8. 策略:策略建议(每产品一句)

## 7. 后端 API 契约

| 方法+路径 | 说明 |
|---|---|
| `GET /` | 静态 index.html(FastAPI StaticFiles 挂 frontend/) |
| `POST /api/runs` | body `{"market":"US","myAsin":"B0..","competitorAsins":["B0..","B0..","B0.."],"reviewsPerStar":20,"useCache":true}` → `{"runId":"..."}`;后台线程执行 pipeline |
| `GET /api/runs` | 运行列表 `[{runId,createdAt,market,myAsin,competitorAsins,stage,status}]`(倒序) |
| `GET /api/runs/{runId}/status` | `{"runId","status":"running|done|error","stage":"fetch_competitor|fetch_detail|fetch_reviews|llm_analysis|assemble","stageLabel":"中文","progress":0-100,"logs":[{"ts","msg"}],"error":null}` |
| `GET /api/runs/{runId}/dashboard` | 上面的 Dashboard JSON;未完成时 404 `{"detail":"not ready"}` |
| `POST /api/runs/{runId}/rebuild` | 用已缓存原始数据重跑 LLM+组装(省 LinkFox 积分) |

Pipeline 关键行为:
- 三类拉取任务尽量并行(线程);评论任务每 ASIN 一个,全部并行提交后统一轮询。
- 每个原始工具结果写 `data/runs/<runId>/raw/<name>.json` **并** 以 `{tool}_{market}_{asinsKey}` 为键写 `data/cache/`;`useCache=true` 时命中缓存直接复用(LinkFox 积分昂贵)。
- 单数据源失败不炸整个 run:对应块置 null/unavailable + note,继续走完。
- LLM 分析:标题五点分析每产品 1 次调用;VOC 每产品 1 次(无评论则跳过,voc.status=unavailable);跨产品综合 1 次;策略建议并入各产品分析调用返回。

## 8. 前端规格(对齐示例截图风格)

整体:浅灰底 `#f5f6f8`,白卡片,圆角 8-10px,细边框 `#e5e7eb`,主色 `#0f766e`(墨绿,链接/按钮),中文 UI。顶部深色标题栏(深藏青 `#1e2a3a`,白字看板标题 + 副标题能力说明)。

页面结构(单页应用,app.js 原生 JS 渲染,无构建步骤;可用 CDN 不可用则纯手写):
1. **控制区**:站点下拉 + 我司ASIN 输入 + 竞品ASIN×3 输入 + 「开始分析」按钮 + 历史运行下拉(选中即加载 dashboard);发起后显示进度条+阶段中文+日志滚动。
2. **产品卡片区**:2×2 网格(移动端 1 列)。卡片含:角标(我司产品=墨绿/直接竞对N=灰蓝)、产品图、品牌名(加粗大字)、标题(2行截断)、链接行(打开商品页/打开视频/品牌页,墨绿下划线链接,视频无则不显示)、2×2 统计小格(销量/销售额/BSR(小类)/评论,浅灰底圆角格,label 小字灰,value 大字黑)。
3. **标题与五点 Alexa/Rufus 分析**:每产品一张子卡(标题"我司产品 B0.."/"直接竞对1 B0..");内部两小节「标题分析」「五点分析」,各三行:优点(绿色标签字)/缺点(橙红标签字)/改进(蓝色标签字)+ 正文。
4. **VOC 聚类**:每产品:好评点top3/差评点top3/未被满足需求,每条一行:要点 + 折叠的证据评论摘录;unavailable 时灰色斜体状态文案。
5. **Review 原文明细**:每产品:缓存评论 N 条;低星评论 N 条 小字说明 + 评论卡列表(星级加粗如"5.0星 标题"、日期灰字、内容;低星(≤3)左边框橙红)。空则显示状态说明。
6. **字段矩阵实例**(核心长表):sticky 表头(属性列 + 每产品一列,列头=roleLabel+ASIN);行按 groups 分组,组名行深色底白字;单元格按 row.type 渲染(image=缩略图、images=小图网格、link=可点链接、badge=彩色小徽章、status=灰斜体、money=$千分位、percent=xx%)。表格横向可滚动,属性列 sticky 左侧。
7. **跨产品综合结论**:summary 段落 + actions 列表。
8. **字段矩阵 SOP 定义表**:三列(类别/属性/SOP),类别列合并感(同类别只在首行显示)。
9. 底部:runId、createdAt、数据源说明(卖家精灵/亚马逊前台 via LinkFox + GLM 分析)。

交互细节:所有区块有锚点导航(顶部横向 tab 链接);dashboard JSON 里 null/unavailable 一律优雅降级显示"暂无数据"或状态文案;不 mock、不编数。

## 9. 验收标准

1. `powershell -File run.ps1` 启动,浏览器打开 `http://127.0.0.1:8916/` 出看板骨架。
2. 用 §4 表格中 6 个已提交任务的真实结果组装出第一份 dashboard(pipeline 支持"注入已有 messageId 结果"或直接读缓存),四个产品完整渲染。
3. 新发起 run 全流程可跑(允许走缓存)。
4. 浏览器截图与示例图风格对齐(卡片/配色/分区)。
