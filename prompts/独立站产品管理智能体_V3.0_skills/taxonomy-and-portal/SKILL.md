---
name: taxonomy-and-portal
description: 重新整理登录型 B2B 独立站的产品分类、标签与筛选项，区分 OEM 成品和原料，识别重复与变体，并在授权范围内实际迁移产品；同时改善已登录买家的站内查找、筛选、规格阅读和询盘路径。不做 Google SEO。
metadata:
  version: "3.0"
  language: "zh-CN"
---

# Skill｜Taxonomy & Portal — 分类整理、去重与站内采购体验

## 一、分类原则

- 站内两个采购入口：**OEM & Private Label Supplements**（品牌方按剂型找）和 **Bulk Ingredients**（原料采购按物质类别找）。Manufacturing Services 是服务说明，不放实物产品。
- 分类表达“**它是什么**”；功能方向、认证、来源、适用市场用**标签/筛选项**表达。
- 每个产品**只有一个主分类**，可以有多个标签。
- 先盘点实际产品再定树；不建空分类。二级分类建议 8–60 个产品，少于 5 个考虑合并，多于 80 个考虑再拆。
- 已有分类结构不同于参考树时，先做“原分类 ID → 目标分类 ID”映射，不直接推倒重建。
- 不因分类调整主动改动产品 URL。

## 二、参考分类树（按实际产品裁剪）

```text
A. OEM & Private Label Supplements
   A1 Gummies | A2 Capsules | A3 Tablets | A4 Softgels
   A5 Powder Supplements & Drink Mixes | A6 Stick Packs & Sachets
   A7 Oral Dissolving Films | A8 Liquid Supplements & RTD Beverages
   A9 Other Custom Dosage Forms（仅在确有能力时）

B. Bulk Ingredients
   B1 Botanical & Herbal Extracts
      Standardized Extracts | Herbal Extract Powders | Mushroom Extracts
      Fruit & Vegetable Extracts | Botanical Powders
   B2 Vitamins & Minerals
      Vitamins | Mineral Ingredients | Vitamin & Mineral Premixes
   B3 Amino Acids & Sports Nutrition Ingredients
      Single Amino Acids | EAA / BCAA Blends | Creatine | Sports Nutrition Actives
   B4 Food Additives
      Sweeteners | Acidity Regulators | Thickeners & Hydrocolloids
      Emulsifiers & Stabilizers | Preservatives | Colors | Flavors
      Excipients & Carriers
   B5 Functional & Specialty Ingredients
      Proteins | Collagen & Peptides | Dietary Fibers & Prebiotics
      Probiotics | Oils & Lipids | Other Specialty Ingredients

C. Manufacturing Services（非产品）
   OEM/ODM Manufacturing | Formula Development | Private Label & Packaging
   Sampling | Quality & Technical Documentation
```

## 三、主分类决策

```text
是服务或说明页？                  → C. Manufacturing Services / 非目录内容
是成品或 OEM 定制方向？            → A. 按剂型
是原料、提取物、预混料？            → B. 按物质类别 → 子类
身份或用途不明？                   → IDENTITY_HOLD（不猜分类）
```

易错示例：
| 产品 | 正确主分类 |
|---|---|
| Private Label Creatine Gummies | A1 Gummies |
| Creatine Monohydrate Powder | B3 Creatine |
| Whey Protein Isolate（原料） | B5 Proteins |
| Vanilla WPI Powder OEM | A5 Powder Supplements |
| Magnesium Bisglycinate | B2 Mineral Ingredients |
| Magnesium Capsules OEM | A2 Capsules |
| Citrus Pectin | B4 Thickeners & Hydrocolloids |

## 四、标签与筛选项（受控词表）

| 维度 | 取值示例 |
|---|---|
| Product Type | Raw Ingredient / Premix / OEM Finished / Service |
| Dosage Form | Gummies / Capsules / Tablets / Softgels / Powder / Liquid … |
| Ingredient Family | Botanical / Vitamin / Mineral / Amino Acid / Additive / Protein … |
| Form / Grade | Food Grade / Supplement Grade / Water-Soluble / Oil … |
| Source | Plant / Animal / Marine / Mineral / Fermentation / Synthetic |
| Certification | HALAL / KOSHER / Organic / Non-GMO / Vegan / Gluten-Free（必须有证书） |
| Documents | COA Available / TDS Available（必须真能提供） |
| Application | Dietary Supplements / Functional Beverages / Sports Nutrition …（中性技术用途） |

- 全站拼写、大小写、单复数统一，不同时出现 `Capsule` / `Capsules` / `Caps`，或 `Non-GMO` / `NonGMO`。
- Sleep、Focus、Beauty、Immunity 等功能主题标签带有功效暗示，使用前过 `export-compliance-gate` 的声称检查。
- 没有依据的标签不为“看起来丰富”而添加；错误标签删除。
- CAS、含量、提取比、包装、MOQ 属于规格字段，不做成分类。

## 五、重复与变体（绝不自动删除）

| 级别 | 判定 | 动作 |
|---|---|---|
| `EXACT_DUPLICATE` | 同一产品对象，两条记录 | 标记；合并或删除需 L2/L3 授权 |
| `POSSIBLE_DUPLICATE` | 学名/形式/规格/包装相同但 ID 不同 | 比较询盘引用和来源，提出保留主记录的建议 |
| `VARIANT_CANDIDATE` | 同一配方，不同口味/包装规格 | 用户批准后再设为变体（L2） |
| `DISTINCT` | 学名、部位、盐型、提取比、纯度、成品/原料任一不同 | 必须保持独立 |

禁止合并：Ashwagandha Root 5% vs Leaf 5%；Creatine Monohydrate Powder vs Creatine Gummies OEM；Vitamin D3 Oil vs Vitamin D3 Powder；Myo-Inositol vs D-Chiro-Inositol；不同菌株的益生菌；元素含量不同的同名矿物盐。

## 六、执行

- **L1**：目标分类已存在 → 逐个产品改主分类与标签 → 保存 → 回读分类 ID。
- **L2**：新建、重命名、移动、隐藏分类，改导航或筛选器 → 先提交审批单：原树、新节点、父级、受影响产品数、可见性影响、链接影响。
- 分类变更顺序：新建分类 → 迁移产品 → 确认旧分类已空 → 旧分类隐藏（不删除；删除另需 L3）。
- 后台支持分类链接重定向时，旧分类链接指向新分类，避免买家收藏的链接失效。

## 七、登录买家门户体验（替代 SEO）

站点需登录访问，目标是让**已获授权的海外买家**更快找到、看懂、询价。

### 五个标准采购任务（有买家视角权限时实测，前后对比步数）
1. 找一个植物提取物的指定含量规格
2. 找某矿物原料的化学形式与元素含量
3. 找 OEM 肌酸软糖
4. 分别找 WPI 原料和 OEM 分离乳清蛋白粉
5. 找一种食品胶体原料（如 Citrus Pectin）

### 问题归因
`WRONG_CATEGORY / MISSING_ATTRIBUTE / AMBIGUOUS_TITLE / BAD_DETAILS / MISSING_SYNONYM / NO_INQUIRY_ROUTE / PERMISSION_ISSUE`

### 可直接修（L1）
产品放错分类、标题含糊、缺规格字段、缺同义词标签、错误或重复标签。

### 需审批（L2）
新增筛选器、改导航、改产品可见范围、改询盘表单结构或接收人。

### 询盘（RFQ）建议字段
Product / SKU、Target Country、Intended Use、Specification or Formula、Pack Size、Quantity、Label Requirements、Required Certifications、Contact Email。

### 可见性
区分 active / draft / hidden / archived / 仅限已批准买家。管理员看得到不代表买家看得到。不把内部技术资料、报价、客户专有配方改为所有买家可见。

### 不做
Google SEO、关键词排名、Meta 标题、Sitemap、Robots、Canonical、Search Console、Analytics。

## 八、验收指标

`classified / wrong_category_fixed / uncategorized_remaining / duplicates_flagged / variants_pending / categories_pending_approval / moves_verified / buyer_tasks_passed`。所有数字来自后台实际读取或回读，不用估算。
