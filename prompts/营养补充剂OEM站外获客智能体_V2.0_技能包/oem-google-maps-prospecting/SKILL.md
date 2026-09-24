---
name: oem-google-maps-prospecting
description: 用谷歌地图寻找可能做自有品牌补充剂的线下渠道（连锁健身房、诊所、药房、健康食品店）和区域进口批发商。执行C渠道任务时使用。优先调用Accio官方谷歌地图获客技能或Places API，按“城市×关键词”检索，再到官网确认有没有自有品牌，输出候选表。
---

# S05 谷歌地图渠道商挖掘

## 目标
用谷歌地图找到可能做自有品牌补充剂的线下渠道（T4）和区域进口批发商（T5），并筛出值得开发的对象。

## 输入
S02 的任务（国家 × 城市 × 关键词）、run_config 中 T4 / T5 是否开启、我方 MOQ、台账、禁联表。

## 步骤
1. 采集工具的优先顺序：Accio 官方的谷歌地图获客技能 → Google Places API（需要预算授权）→ 浏览器手动检索（每个“城市 × 关键词”最多看前 40 条）。
2. 关键词使用目标国的语言：
   - T4：supplement store、vitamin store、health food store、gym、fitness center、chiropractor、naturopath、functional medicine clinic、med spa、weight loss clinic、pharmacy；
   - T5：supplement distributor、supplement wholesaler、nutrition distributor、health products importer；
   - 西语、阿语、葡语等市场改用当地语言的关键词。
3. 记录：名称、类别、地址、城市、电话（仅限公开的业务号码）、网站、评分、评论数、营业状态、地图链接。
4. 初筛：必须有官网；排除永久停业、没有公司主体的个人工作室、同行工厂。T4 优先有 3 家以上门店的连锁，或评论数排在前 20% 的商家。
5. 打开官网判断：
   - 已有自有品牌补充剂（“our brand”、“house brand”、带自家 logo 的产品）：说明已经在委托生产，外包证据记 15 分；
   - 没有自有品牌但规模较大：列为“可以推荐做自有品牌”；
   - T5：看代理的品牌、进口业务说明和覆盖区域。
6. 记录官网上的业务邮箱、表单、WhatsApp（仅限对方公开用于业务的号码）和社媒链接。
7. 去重后交给 S08。如果我方 MOQ 不支持小批量，T4 只保留大型连锁。

## 输出
候选表：名称｜类型（T4 子类 / T5）｜城市和国家｜门店数｜评分和评论数｜官网｜是否有自有品牌（及证据）｜联系入口｜地图链接｜查看日期。

## 规则
遵守谷歌地图的服务条款，不大规模抓取；不自动打电话，不群发 WhatsApp；不收集个人执业者的私人电话和住址。
