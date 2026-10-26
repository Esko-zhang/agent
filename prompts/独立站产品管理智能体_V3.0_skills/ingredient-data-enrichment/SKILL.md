---
name: ingredient-data-enrichment
description: 补全原料类产品的身份、规格、质量指标和英文详情，覆盖植物提取物、菌菇提取物、维生素、矿物质、氨基酸与肌酸、食品添加剂、蛋白与胶原、膳食纤维、益生菌；按证据等级决定能否写入后台，并交给 backend-operations 保存回读。
metadata:
  version: "3.0"
  language: "zh-CN"
---

# Skill｜Ingredient Data Enrichment — 原料信息补全

## 一、单品补全流程

1. 从后台读取：Product ID、SKU、原标题、分类、已有规格、原描述、附件。
2. 判断类型：单一原料 / 复配原料 / 预混料。属于 OEM 成品的转 `oem-product-completion`。
3. 检查名称、CAS、盐型、物种、部位、含量、检测方法之间是否矛盾；有矛盾的字段先冻结。
4. 读取本产品的 TDS / COA / 规格书 / 正式配方。
5. 给每个拟写字段标证据等级（见主提示词 P1–P4 / UNKNOWN）。
6. 交 `export-compliance-gate` 做合规分流；HOLD 的产品只处理不受影响的字段。
7. 按第五节的命名规范和第六节的模板生成英文内容。
8. 形成 `before → after`，交 `backend-operations` 写入并回读。
9. 未补全的字段写明原因：`MISSING_TDS / NAME_AMBIGUOUS / CAS_AMBIGUOUS / FORM_UNKNOWN / SUPPLIER_CONFIRMATION_NEEDED / LEGAL_HOLD`。

**完成标准不是生成英文草稿，而是后台回读为 `SAVED_VERIFIED`。** 没有写入权限时如实报告，不说“已补全”。

## 二、通用字段

- 身份：英文品名、别名/同义词、CAS（仅单一明确物质）、EINECS/EC、INS/E 编号（添加剂）、HS 编码（仅有报关依据时）
- 质量：干燥失重/水分、灰分、重金属（Pb / As / Cd / Hg）、农药残留、溶剂残留、微生物（菌落总数、霉菌酵母、大肠杆菌、沙门氏菌、金黄色葡萄球菌）、真菌毒素、辐照声明、过敏原、非转基因声明
- 认证：ISO 22000 / FSSC 22000 / HACCP / BRC / HALAL / KOSHER / Organic / Vegan，必须与该产品的生产工厂和有效期对应
- 商务：包装、储存条件、保质期、MOQ、交期、原产地、可提供文件（COA / TDS / MSDS / 流程图 / 过敏原声明）

## 三、分品类要点与陷阱

### A. 植物提取物 / 菌菇提取物
- 必核：英文通用名、拉丁学名（属+种）、科、使用部位、提取物类型（标准化提取物 / 比例提取物 / 原粉）、提取比（DER）、标志成分、含量、检测方法、提取溶剂、载体、外观、目数。
- 陷阱：
  - `10:1` 是提取比，**不等于** `10%` 标志成分。
  - 根、叶、果、地上部分是不同产品。
  - 一个中文俗名可能对应多个拉丁学名，必须核学名。
  - 标志成分含量要和检测方法一起写（如 “Withanolides ≥ 5% by HPLC”）；UV 与 HPLC 结果不可互换。
  - 菌菇类要区分子实体、菌丝体、发酵菌丝体，多糖与 β-葡聚糖的检测方法不同。

### B. 维生素
- 必核：化学形式（如 D3 = Cholecalciferol，D2 = Ergocalciferol）、效价（IU/g 或 %）、载体、油剂或粉剂、等级、检测方法。
- 陷阱：同名 “Vitamin D3 Powder” 不同厂家效价和载体不同，不能套用固定值；µg 与 IU 的换算只能在确定维生素种类后进行，换算值不是批次检测值。

### C. 矿物质
- 必核：化合物名、盐型或螯合形式、CAS、化合物含量、**元素含量**、结晶水、重金属。
- 陷阱：**盐的重量不等于元素量**。500 mg 甘氨酸镁不等于 500 mg 元素镁；甘氨酸镁、柠檬酸镁、氧化镁的元素含量完全不同。Bisglycinate 与 Glycinate 写法要按规格书确认。

### D. 氨基酸 / 肌酸 / 运动原料
- 必核：L- / D- / DL- 构型、游离型或盐型或水合物、化学名、CAS、纯度、目数；旋光度、干燥失重等有规格书才写。
- 陷阱：Creatine Monohydrate 与 Creatine HCl 是不同产品；EAA / BCAA 是复配，必须写清组成和比例；瓜拉纳等来源的咖啡因要区分提取物用量与纯咖啡因贡献量。

### E. 食品添加剂
- 必核：添加剂名称、功能类别（甜味剂、增稠剂、乳化剂、酸度调节剂、防腐剂、色素、香料等）、INS/E 编号、化学形式、纯度/等级、溶解性。
- 陷阱：供应添加剂原料 ≠ 它能用于客户目标国的某个食品类别和用量；果胶、黄原胶、结冷胶等不能互相替代描述。

### F. 蛋白 / 胶原 / 纤维 / 益生菌
- 蛋白：WPC / WPI / MPI / 植物蛋白类别、蛋白含量及计算基准（干基/湿基）、乳糖、过敏原。
- 胶原：来源物种与部位（牛皮、鱼皮鱼鳞、猪皮）、水解程度与分子量（有数据才写）；HALAL、有机、草饲各需独立证据。
- 纤维：来源、检测方法、可溶/不可溶。
- 益生菌：菌种 + **菌株号**、CFU 及计数时点（出厂时 / 保质期末）、储存条件。不同菌株不可互换描述。

## 四、禁止写法

- 无证书写 Organic、Grass-fed、Non-GMO。
- “FDA registered” 写成 “FDA approved”。
- 疾病功效：treat / cure / prevent / heal / anti-cancer / clinically proven to treat…
- 用另一个批次或另一个工厂的 COA 证明本产品。
- 用“行业常见值”填充本产品的质量指标、保质期、MOQ。

## 五、命名规范（原料）

格式：`[规范英文名] [规格/含量] [形态]`，同类产品写法统一。

| 原始模糊名称 | 需核实 | 规范方向（核实后才用） |
|---|---|---|
| Magnesium Glycinate | 是否双甘氨酸螯合，元素镁 % | Magnesium Bisglycinate Powder, [x]% Elemental Mg |
| Vitamin D3 Powder | 效价、载体 | Vitamin D3 (Cholecalciferol) Powder [x] IU/g |
| Ashwagandha 5% | 学名、部位、检测方法 | Ashwagandha Root Extract, Withanolides [x]% (HPLC) |
| Creatine | 化学形式 | Creatine Monohydrate Powder, [mesh] |
| Pectin | 来源与类型 | Citrus Pectin, [HM/LM] |
| EAA | 组成与比例 | Essential Amino Acids Blend ([组成]) |

- 不堆营销词（Best / Hot Sale / Top Quality / Factory Price）。
- 别名、缩写、常见拼写变体（如 WPI / Whey Protein Isolate）放进标签或站内搜索关键词字段，让买家站内能搜到，不塞进标题。

## 六、英文详情模板（原料）

没有核实数据的行直接删除；页面上不出现 TBC、N/A、待补充。

```markdown
## Product Overview
[1–3 factual sentences: identity, source (botanical name & part) or chemical form, key specification, B2B supply context.]

## Specifications
| Parameter | Specification | Method |
|---|---|---|
| Botanical Name / Chemical Name | | |
| Part Used / Chemical Form | | |
| CAS No. | | |
| Marker / Assay | | |
| Extract Ratio | | |
| Extraction Solvent | | |
| Appearance | | |
| Particle Size | | |
| Solubility | | |

## Quality Parameters
| Item | Limit | Method |
|---|---|---|
| Loss on Drying | | |
| Ash | | |
| Lead / Arsenic / Cadmium / Mercury | | |
| Pesticide Residues | | |
| Residual Solvents | | |
| Total Plate Count | | |
| Yeast & Mold | | |
| E. coli / Salmonella / S. aureus | | |

## Typical Applications
Commonly used in dietary supplements, functional foods and beverages. Suitability for a specific market and application is subject to the buyer's regulatory review.

## Packaging & Storage
[Verified packaging, storage conditions, shelf life]

## Certifications
[Only certifications confirmed for this product and factory]

## Documents
[Only documents actually available, e.g. COA / TDS / MSDS available upon request]

## Request a Quote
Please share your target market, required specification, quantity and documentation needs.
```
