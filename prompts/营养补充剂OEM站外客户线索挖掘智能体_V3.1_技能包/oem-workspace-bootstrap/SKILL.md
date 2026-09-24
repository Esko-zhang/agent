---
name: oem-workspace-bootstrap
description: 补充剂OEM客户线索挖掘的工作区初始化与自动补全。每次运行开始时最先使用；用户说“初始化”或提示缺少文件时也使用。检查工作目录和所需文件（run_config、线索总库、排除名单、checkpoint、竞品工厂名单、关键词矩阵、Amazon类目、城市清单、社媒检索词、商标检索词），缺什么就按内置默认模板自动创建；已有文件只补缺失字段，不覆盖原值。不因缺文件停止运行，也不要求用户上传。
---

# S00 工作区初始化与自动补全

## 目标
保证每次运行都能直接开始。工作区里缺少的文件和字段，由本技能按默认模板自动创建或补全。除了竞品工厂名单建议由用户提供，其他文件都不需要用户上传。缺少任何文件，都不能成为停止运行或要求用户上传的理由。

## 步骤
1. **确定工作目录**：在当前工作区下使用 `OEM_Leads/`；不存在就创建，并建好子目录 00_Config、01_Offer、02_Channels、03_Ledger、04_Output。
   - 如果无法写入文件，改用“内存模式”：在本次对话中按下面的模板生成全部内容，照常运行；运行结束时输出这些文件的完整内容，并注明“未保存为文件”。
2. **逐个检查文件**，缺失的按下表处理：

| 文件 | 缺失时的处理 |
|---|---|
| 00_Config/run_config.yaml | 按模板 1 创建。市场、剂型、客户类型、MOQ 优先取用户在对话中或智能体“背景”里给出的信息；没有的使用默认值，并写进 assumptions |
| 03_Ledger/checkpoint.json | 按模板 2 创建，视为首次运行 |
| 03_Ledger/master_leads.csv | 按模板 3 只写表头。空的总库表示没有历史记录，去重照常进行 |
| 01_Offer/exclusions.csv | 按模板 4 只写表头 |
| 01_Offer/competitor_factories.csv | 按模板 5 只写表头；用户在对话中给了竞品名单的，写入并标记 source=user、status=confirmed |
| 02_Channels/keyword_matrix.csv | 按模板 6 生成，只保留 run_config.scope.focus_forms 中的剂型 |
| 02_Channels/amazon_categories.csv | 按模板 7 生成 |
| 02_Channels/cities.csv | 按模板 8 生成主市场的城市；设了次市场的，一并生成 |
| 02_Channels/social_queries.txt | 按模板 9 生成 |
| 02_Channels/uspto_terms.txt | 按模板 10 生成 |

3. **已有文件只补不改**：文件存在但缺少字段或列的，只补缺失部分，不覆盖用户填过的值。文件格式损坏、无法读取的，先另存为 `原文件名.bak`，再按模板重建，并在运行摘要中说明。
4. **global_pause 的读取规则**：以 run_config.yaml 中的 global_pause 为准，不从 checkpoint 读取。
   - 文件或字段不存在时，按 false 处理并写入文件。本智能体没有任何对外联系或发送动作，默认 false 不会带来风险。
   - 只有用户明确说过“暂停”（此时写入 true）才停止运行。
5. **竞品工厂名单为空时**，不停止，也不要求用户先提供：
   - S02 跳过“竞品工厂反查”，改用“产品描述反查”；
   - 产品描述反查结果中，发货人是中国补充剂成品工厂的，写入 competitor_factories.csv，标记 source=auto、status=pending；
   - 本次运行可以用这些自动发现的工厂继续做反查（只是查询数据，不联系任何人）；
   - 运行结束时，请用户确认这些候选同行，或补充自己知道的同行。
6. **记录**：在 checkpoint.json 的 bootstrap 字段里，记录本次自动创建或补全了哪些文件、使用了哪些默认假设。
7. **运行结束时再提问**：不在运行开始时提问等待。运行结束时最多提 3 个问题，优先问：竞品工厂名单；产品范围和 MOQ 是否正确；有没有现有客户需要排除。

## 只有这两种情况才停止
- run_config.yaml 中的 global_pause 为 true；
- 浏览器完全不可用。此时说明原因，并建议改用“名单背调任务”（用户提供公司名单或网站）。

## 模板

**模板 1｜00_Config/run_config.yaml**

```yaml
config_version: OEM-LEADS-3.1
auto_generated: true
assumptions: []                     # 例如 ["市场默认美国", "剂型默认软糖和粉剂"]
global_pause: false
timezone_internal: Asia/Shanghai
scope:
  primary_market: US
  secondary_market: null
  focus_forms: [gummies, powder]
  moq_note: null
  small_moq_supported: false
  customer_types: [T1, T2]
  secondary_customer_types: [T3, T4, T5]
  include_cn_sellers: true
channels:
  weights: {A_customs: 30, B_marketplace: 30, C_google_maps: 15, D_social_public: 15, E_new_brand: 10}
  excluded_lead_sources: [alibaba.com, 1688.com, made-in-china.com, globalsources.com]
  competitor_auto_discover: true
daily:
  raw_candidates: 60
  target_delivered: 20
  max_pages_per_site_per_run: 8
  max_minutes: 120
  paid_spend_cny: 0
linkedin:
  login: false
  max_profile_views_per_day: 30
verification:
  field_max_age_days: 7
  company_activity_max_age_days: 180
  import_record_max_age_days: 365
  contact_role_evidence_max_age_days: 365
  min_independent_sources_company: 2
  domain_min_age_days: 180
  reject_registry_status: [dissolved, inactive, revoked, forfeited, struck_off]
  check_fda_warning_letters: true
  allow_guessed_emails: false
  smtp_probe: false
  whatsapp_number_check: false
contact_actions: {send_email: false, send_whatsapp: false, send_social_dm: false, submit_forms: false, phone_calls: false}
files:
  ledger: 03_Ledger/master_leads.csv
  checkpoint: 03_Ledger/checkpoint.json
  exclusions: 01_Offer/exclusions.csv
  competitors: 01_Offer/competitor_factories.csv
  channels_dir: 02_Channels/
output:
  daily_file: "04_Output/客户线索_{date}_{market}.md"
  weekly_file: "04_Output/客户线索周汇总_{year}W{week}.md"
  include_pending_section: true
  include_rejected_section: false
```

**模板 2｜03_Ledger/checkpoint.json**

```json
{
  "last_run_id": null,
  "last_run_at": null,
  "status": "new",
  "processed_lead_ids": [],
  "pending_queue": [],
  "channel_rotation": {},
  "bootstrap": {"created_files": [], "patched_fields": [], "assumptions": []},
  "notes": "首次运行自动创建"
}
```

**模板 3｜03_Ledger/master_leads.csv**（只写这一行表头）

```text
lead_id,company_legal_name,brand_name,domain,country,state_city,customer_type,source_channels,source_urls,products_seen,outsourcing_evidence,import_summary,signal,background_status,background_flags,reject_reason,registry_status,registry_url,last_activity_date,contact_name,contact_title,contact_email,email_grade,company_email,phone,whatsapp,linkedin_url,total_score,tier,first_found_at,last_verified_at,delivered_in_file
```

**模板 4｜01_Offer/exclusions.csv**（只写表头；type 取 domain 或 company，reason 例如“现有客户”“不需要”）

```text
type,value,reason,added_at
```

**模板 5｜01_Offer/competitor_factories.csv**（只写表头；source 取 user 或 auto，status 取 confirmed 或 pending）

```text
factory_name_en,aliases,source,status,added_at
```

**模板 6｜02_Channels/keyword_matrix.csv**（只保留 focus_forms 中的剂型）

```text
form,marketplace_keywords,customs_keywords,hs_hint,last_used
gummies,creatine gummies; vitamin gummies; multivitamin gummies; magnesium gummies; ashwagandha gummies; collagen gummies; apple cider vinegar gummies,gummies; gummy vitamin; gummy supplement,2106.90; 1704.90,
capsules,magnesium glycinate capsules; ashwagandha capsules; probiotic capsules; turmeric capsules; sea moss capsules,capsules; dietary supplement capsules; vitamin capsules,2106.90; 3004.50,
tablets,vitamin d3 tablets; multivitamin tablets; biotin tablets; effervescent tablets,tablets; vitamin tablets; effervescent tablets,2106.90; 3004.50,
softgels,fish oil softgels; omega-3 softgels; vitamin d3 softgels; coq10 softgels,softgel; fish oil softgel,2106.90; 1504.20,
powder,creatine monohydrate powder; electrolyte powder; collagen peptides powder; protein powder; greens powder; pre-workout powder,protein powder; creatine; electrolyte powder; collagen powder,2106.10; 2106.90; 3504.00,
```

**模板 7｜02_Channels/amazon_categories.csv**（category_hint 只是提示，以 Amazon 当前页面左侧类目树的实际名称为准；只保留与 focus_forms 相关的行）

```text
marketplace,category_hint,forms,list_types,last_used
amazon.com,Multivitamins,gummies; tablets; capsules,best_sellers; new_releases; movers_shakers,
amazon.com,Vitamin D,gummies; softgels; tablets,best_sellers; new_releases,
amazon.com,Magnesium,gummies; capsules; powder,best_sellers; new_releases,
amazon.com,Herbal Supplements (Ashwagandha / Turmeric),gummies; capsules,best_sellers; new_releases,
amazon.com,Probiotics,capsules; gummies,best_sellers; new_releases,
amazon.com,Collagen,powder; gummies; capsules,best_sellers; new_releases,
amazon.com,Fish Oil & Omega-3,softgels,best_sellers; new_releases,
amazon.com,Sports Nutrition > Creatine,powder; gummies,best_sellers; new_releases; movers_shakers,
amazon.com,Sports Nutrition > Protein,powder,best_sellers; new_releases,
amazon.com,Sports Nutrition > Electrolytes / Hydration,powder; tablets,best_sellers; new_releases,
amazon.com,Sports Nutrition > Pre-Workout,powder,best_sellers; new_releases,
tiktok_shop_us,Search: creatine gummies / magnesium / electrolyte / sea moss,gummies; capsules; powder,search_results; top_selling,
```

**模板 8｜02_Channels/cities.csv**（只保留主市场和次市场的行；priority 1 最先跑）

```text
country,city,priority,last_used
US,New York,1,
US,Los Angeles,1,
US,Chicago,1,
US,Dallas-Fort Worth,1,
US,Houston,1,
US,Atlanta,1,
US,Miami,1,
US,Washington DC,2,
US,Philadelphia,2,
US,Phoenix,2,
US,Boston,2,
US,San Francisco,2,
US,Seattle,2,
US,San Diego,2,
US,Tampa,2,
US,Denver,2,
US,Riverside,3,
US,Detroit,3,
US,Minneapolis,3,
US,Baltimore,3,
CA,Toronto,1,
CA,Vancouver,1,
CA,Montreal,2,
CA,Calgary,2,
AU,Sydney,1,
AU,Melbourne,1,
AU,Brisbane,2,
GB,London,1,
GB,Manchester,2,
GB,Birmingham,2,
AE,Dubai,1,
AE,Abu Dhabi,2,
SA,Riyadh,1,
SA,Jeddah,2,
```

**模板 9｜02_Channels/social_queries.txt**（在搜索引擎中使用；使用记录写入 checkpoint 的 channel_rotation）

```text
# 求购信号（只看最近 30 天的结果）
site:linkedin.com/posts "looking for supplement manufacturer"
site:linkedin.com/posts "private label supplements" recommend
site:reddit.com "supplement manufacturer" recommend
site:reddit.com "private label" gummies manufacturer
site:facebook.com/groups "supplement manufacturer"
"looking for a gummy manufacturer"
"starting a supplement brand" manufacturer
# 扩张信号
site:linkedin.com/jobs "product development" supplement
site:linkedin.com/jobs "sourcing manager" nutraceutical
# 决策人（把 {brand} 换成公司或品牌名）
site:linkedin.com/in "{brand}" (founder OR "co-founder" OR CEO OR owner OR "head of product" OR sourcing OR procurement OR operations)
```

**模板 10｜02_Channels/uspto_terms.txt**（USPTO 商标检索：第 5 类，申请日在最近 30–90 天；使用记录写入 checkpoint 的 channel_rotation）

```text
dietary supplements
nutritional supplements
vitamin gummies
gummy vitamins
protein powder
sports nutrition
electrolyte
creatine
collagen
probiotic
```

## 输出
工作区检查结果：已存在的文件、自动创建的文件、补全的字段、使用的默认假设、global_pause 的值。交给 S01 继续运行；运行结束时，这些内容会写进运行摘要。
