---
name: oem-product-completion
description: 补全 OEM/ODM 成品营养补充剂的产品信息：剂型、配方性质、每份含量、包装、口味、可定制项、MOQ 与交期、质量文件和英文询盘内容；区分“OEM 能力展示页”和“固定配方成品”，交给 backend-operations 保存回读。
metadata:
  version: "3.0"
  language: "zh-CN"
---

# Skill｜OEM Product Completion — OEM 成品信息补全

## 一、先区分两类页面

| 类型 | 是什么 | 写法要求 |
|---|---|---|
| `OEM_CAPABILITY` 能力展示页 | 展示某剂型/某方向可以定制，例如 “Custom Gummies Manufacturing” | 配方只能写成示例或可定制范围，必须标明 “illustrative / customizable”，不得暗示已量产固定配方 |
| `FIXED_SKU` 固定成品 | 有明确配方、规格、包装的具体产品 | 配方、每份含量、规格必须有工厂确认的数据 |

两类不能混写。判断不了时记 `formulation_status = TBC`，按能力展示页的保守写法处理。

## 二、字段矩阵

| 字段 | 能力展示页 | 固定成品 | 注意 |
|---|---|---|---|
| 剂型 | 必填 | 必填 | Gummies / Capsules / Tablets / Softgels / Powder / Stick Pack / ODF / Liquid / RTD 不混用 |
| 活性成分 | 示例需标注 | 必须经确认 | 不用未证实的“热门配方”凑数 |
| 每份含量 | 可选，标注示例 | 必填 | 区分原料投入量、有效成分量、元素量；mg / g / µg / IU 不混用 |
| 每份用量 / 每包数量 | 可选 | 必填 | 每份粒数与每瓶粒数分开写 |
| 口味 | 真实可开发的选项 | 必填 | “天然口味”“无糖”需证据 |
| 包装 | 真实可提供的选项 | 必填 | 容量与净含量一致 |
| 可定制项 | 必填 | 视情况 | 配方 / 口味 / 颜色 / 形状 / 包衣 / 包装 / 标签设计，只写真实支持的 |
| MOQ / 交期 | 有正式政策才写 | 当前确认值 | 历史报价不能当通用值；样品与大货交期分开 |
| 认证与文件 | 与实际生产工厂对应 | 与产线对应 | 不跨工厂套用证书 |
| 目标市场标签支持 | 实际能做的才写 | 同左 | 例如 US Supplement Facts、EU 标签格式 |

## 三、剂型检查点

- **软糖**：每粒活性含量、每份粒数、明胶或果胶、含糖或无糖；热加工与水分活度对活性成分含量的影响；不承诺无证据的长期稳定性（如肌酸软糖）。
- **胶囊 / 片剂**：胶囊型号与壳材（明胶 / HPMC）、填充量、每份粒数；配方总粉量明显超出胶囊容积时标记研发确认，不承诺可装。
- **粉剂 / 条包**：每份或每条净含量、每盒条数、冲调水量、溶解性、口味；甜味剂、抗结剂尚未确定时不写成已定配方。
- **口溶膜 ODF**：每片剂量、膜材、防潮包装、溶解时间；口腔吸收类宣称需证据，并核目标国对该剂型的监管归类。
- **液体 / RTD**：每瓶容量、杀菌工艺、货架期验证、沉淀与分层试验、微生物验证。
- **蛋白 / 胶原粉**：蛋白原料类别与含量、乳糖与过敏原、每份营养数据；草饲、有机、HALAL 独立核证。

## 四、配方校核

1. 统一单位，分清“原料投入量”“有效成分量”“元素量”。
2. 每份活性成分总量 + 辅料 + 胶囊壳/包衣，应与每份净重大致吻合；明显不符时标记研发确认。
3. 高含量草本、药用边界成分、争议成分转 `export-compliance-gate`。目标市场未知时不写法规保证。
4. MOQ、稳定性、包装、交期以工厂证据为准，缺失则进入待提供清单。
5. 不公开内部报价、客户专有配方、底价。

## 五、命名规范（成品）

- 能力展示页：`Custom [Product/Function] [Dosage Form] — OEM / Private Label`，如 `Custom Creatine Gummies — OEM / Private Label`
- 固定成品：`[Core Ingredient + Amount] [Dosage Form], [Count]`，如 `Magnesium Bisglycinate 200 mg Elemental Capsules, 120 Count`
- 不在标题里写功效承诺和营销词。

## 六、英文详情模板（OEM 成品）

没有核实数据的行直接删除。

```markdown
## Product Overview
[Dosage form, nature of the product (fixed formula or customizable), positioning for brand owners.]

## Formula & Specifications
| Item | Detail |
|---|---|
| Dosage Form | |
| Formula Status | Fixed formula / Illustrative — fully customizable |
| Key Ingredients (per serving) | |
| Serving Size | |
| Count / Net Content | |
| Free From | |

## Customization Options
[Only options actually supported: formula / flavor / color / shape / coating / packaging / label design]

## MOQ & Lead Time
[Only confirmed values; otherwise omit this section]

## Packaging
[Bottle / pouch / blister / stick pack options, closure, desiccant, carton]

## Quality & Compliance Support
[Documentable testing, factory certifications, label formats supported for target markets]

## Request a Custom Quote
Please share your target market, dosage form, formula or target actives, pack size, order quantity and label requirements.
```

## 七、常见错误

- 原料 `Magnesium Bisglycinate Powder` 写成 OEM 成品 `Magnesium Capsules`，或反之。
- 不同配方因剂型相同而被合并成变体。
- “示例配方含 500 mg Citicoline” 被写成已量产且所有国家都允许。
- 照搬供应商网站的医疗功效宣传。
