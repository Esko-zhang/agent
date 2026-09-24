---
name: oem-social-prospecting
description: 在LinkedIn、Instagram、TikTok、YouTube、Facebook群组和Reddit上，只读取公开资料做补充剂OEM客户研究。执行D渠道任务、或需要为公司找决策人时使用。找公开求购帖和扩张信号、找网红自有品牌、通过搜索引擎查决策人姓名和职位。不登录、不加好友、不发私信、不评论。
---

# S05 社媒公开资料挖掘

## 目标
只使用公开资料完成三件事：① 找到公开求购帖和扩张信号；② 找到网红 / KOL 的自有品牌（T3）；③ 为公司找到决策人的姓名、职位和主页链接。

## 输入
S01 的任务（求购短语、话题标签）、需要找决策人的公司清单（来自 S07）、run_config.linkedin 的设置、线索总库。

## 步骤
A. 求购与扩张信号（只看最近 30 天）
1. 通过搜索引擎和平台的公开页面，搜索 LinkedIn 帖子、Facebook 公开群组和 Reddit 上的 “looking for supplement manufacturer”、“private label supplements”、“recommend a gummy manufacturer”、“contract manufacturer capsules”、“starting a supplement brand”。
2. 记录：发帖人、所在公司（如有）、帖子 URL、日期、原文要点（需要的剂型、数量、市场）。发帖人是个人、又没有公司信息的，只记为信号，不作为交付客户。
3. 通过搜索引擎查 LinkedIn 招聘和公司动态：在招 product development、sourcing、procurement（supplement、nutraceutical 方向）岗位的公司，以及宣布新产品线或融资的公司，记为时机信号。

B. 网红品牌（T3）
4. 找健身、营养、健康类博主（粉丝 1 万–200 万），简介或近期内容提到自有补充剂品牌或商店链接的。
5. 记录：账号、平台、粉丝数、品牌名和商店链接、最近一次发帖日期、简介里公开的商务邮箱。

C. 决策人
6. 默认不登录 LinkedIn，用搜索引擎检索：`site:linkedin.com/in "公司或品牌名" (founder OR "co-founder" OR CEO OR owner OR "head of product" OR "product development" OR sourcing OR procurement OR operations)`。
7. 从搜索结果和公开页面中读取姓名、职位、公司，保存主页 URL 和检索日期。结果中显示 “former”、“ex-” 或已有离职日期的不采用。
8. run_config 允许登录时，只用用户本人的真实账号，按人工节奏查看，每天不超过 max_profile_views_per_day；出现任何限制提示立即停止。

## 输出
信号表（类型｜来源 URL｜日期｜要点）、T3 网红品牌表、决策人候选表（姓名｜职位｜公司｜主页 URL｜来源｜日期）。决策人在职情况交给 S08 第二轮核验。

## 规则
不加好友，不发私信，不点赞、不评论、不回帖，不开小号，不收集消费者的个人信息。
