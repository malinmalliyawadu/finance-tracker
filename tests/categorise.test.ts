/**
 * Unit tests for the engine. No database: rules in, verdict out.
 *
 * These assert the behaviours that are easy to break by reordering the rules
 * file, and that a coverage percentage would not notice — a rule set can be
 * 100% covered and still put every pharmacy purchase in groceries.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { categorise, cleanDescription, compileAliases, compileRules } from '../src/lib/categorise.ts'
import { buildSeedPlan, parseRulesFile } from '../src/lib/rules-file.ts'

const file = parseRulesFile(
  JSON.parse(readFileSync(fileURLToPath(new URL('../data/categorisation-rules.json', import.meta.url)), 'utf8')),
)
const plan = buildSeedPlan(file)

// Stand-in ids: the engine only cares that categories are distinguishable.
const rules = compileRules(
  plan.rules.map((rule, i) => ({
    id: String(i).padStart(4, '0'),
    priority: rule.priority,
    ruleType: rule.ruleType,
    pattern: rule.pattern,
    appliesTo: rule.appliesTo,
    categoryId: rule.categoryName,
    exclusionReason: rule.exclusionReason,
  })),
)

const aliases = compileAliases(
  plan.aliases.map((alias, i) => ({
    id: `a${i}`,
    priority: alias.priority,
    pattern: alias.pattern,
    displayName: alias.displayName,
    isPayg: alias.isPayg,
  })),
)

const classify = (description: string, amount: number) =>
  categorise({ description, amount }, rules, aliases)

test('order is load-bearing: pharmacy beats groceries', () => {
  // "UNICHEM" would also match nothing in groceries, but "New World Chemist"
  // style descriptors are exactly why the pharmacy band sits first.
  assert.equal(classify('UNICHEM THORNDON PHARMACY', -32).categoryId, 'Health & pharmacy')
  assert.equal(classify('NEW WORLD WILLIS ST', -84).categoryId, 'Groceries')
})

test('exclusions beat every spending category', () => {
  const verdict = classify('AMEX PAYMENT', -2400)
  assert.equal(verdict.exclusionReason, 'card_payment')
  assert.equal(verdict.categoryId, null, 'an excluded row must not also carry a category')
})

test('passthrough is caught before it can be booked as income', () => {
  assert.equal(classify('SALARY CXC GLOBAL NZ LTD', 5400).exclusionReason, 'passthrough')
  assert.equal(classify('PAY M MALLIYA WADU', -5100).exclusionReason, 'passthrough')
})

test('direction separates the patterns that appear on both sides', () => {
  assert.equal(classify('SHARESIES LIMITED', -1900).categoryId, 'Investing & round-ups')
  assert.equal(classify('SHARESIES LIMITED', 1900).categoryId, 'Sharesies withdrawal')

  assert.equal(classify('TORY STREET CAR PARK', -6).categoryId, 'Transport & fuel')
  assert.equal(classify('BILL PAYMENT CAR PARK RENT', 185).categoryId, 'Car park rent received')
})

test('a refund stays in the category it was spent from', () => {
  // Positive amount, no income rule matches, so it lands back in the expense
  // category where it correctly reduces the total.
  const verdict = classify('KATHMANDU LTD', 149.99)
  assert.equal(verdict.categoryId, 'Clothing & grooming')
  assert.equal(verdict.exclusionReason, null)
})

test('non-consumption categories are still categories, not exclusions', () => {
  const loan = classify('LOAN PMT 38-9014-0271553-01', -3400)
  assert.equal(loan.categoryId, 'Loan repayments')
  assert.equal(loan.exclusionReason, null, 'loan repayments are excluded from spend by category, not by exclusion')
})

// A mortgage is modelled exactly like a credit card: the cost is the interest
// charged to the account, and the automatic payment is the settlement of that
// cost. Counting both would double count $24,018 a year; counting neither would
// drop housing out of spending entirely.
test('mortgage interest is the cost, and counts as a living cost', () => {
  const interest = classify('LOAN INTEREST', -725.4)
  assert.equal(interest.categoryId, 'Mortgage interest')
  assert.equal(interest.exclusionReason, null)
})

test('mortgage interest is not swallowed by the generic interest rule', () => {
  // "Fees & interest" carries a bare `interest` pattern, so Mortgage interest
  // only wins because it is ordered ahead of it.
  assert.equal(classify('LOAN INTEREST', -725.4).categoryId, 'Mortgage interest')
  assert.equal(classify('INTEREST DEBIT', -4.2).categoryId, 'Fees & interest')
})

test('the mortgage standing orders are settlements, not spending', () => {
  for (const ap of ['12594087', '22647266', '23258687']) {
    const verdict = classify(`AP#${ap} TO M S MALLIYAWADU`, -1165.9)
    assert.equal(verdict.exclusionReason, 'card_payment', `AP#${ap} should settle, not spend`)
    assert.equal(verdict.categoryId, null)
  }
})

test('the savings standing order is an internal transfer, not a settlement', () => {
  // Same descriptor shape, different AP number, completely different meaning:
  // this one moves money to Rainy day rather than paying down a mortgage.
  const verdict = classify('AP#22093831 TO M S MALLIYAWADU', -500)
  assert.equal(verdict.exclusionReason, 'internal_transfer')
})

test('the receiving leg of any standing order is excluded', () => {
  // Otherwise every mortgage payment would arrive back as phantom income.
  assert.equal(classify('AP#12594087 FROM M S MALLIYAWADU', 1165.9).exclusionReason, 'card_payment')
  assert.equal(classify('AP#99999999 FROM M S MALLIYAWADU', 250).exclusionReason, 'internal_transfer')
})

test('aliases resolve descriptor drift to one merchant', () => {
  assert.equal(classify('EZI*HEALTH AND FITNESS', -88).merchantDisplayName, 'Bikram / Yoga for the People')
  assert.equal(classify('YOGA FOR THE PEOPLE WGTN', -88).merchantDisplayName, 'Bikram / Yoga for the People')
  assert.equal(classify('WGTN CITY COUNCIL RATES', -268).merchantDisplayName, 'Wellington City Council')
})

test('pay-as-you-go merchants are flagged from the alias', () => {
  assert.equal(classify('EZI*HEALTH AND FITNESS', -88).isPayg, true)
  assert.equal(classify('NETFLIX.COM', -25).isPayg, false)
})

test('unmatched descriptors are reported, not silently bucketed', () => {
  const verdict = classify('SQ *SOME MARKET STALL', -22)
  assert.equal(verdict.classifiedBy, 'unmatched')
  assert.equal(verdict.categoryId, null)
  assert.equal(verdict.exclusionReason, null)
})

test('descriptors clean up without inventing a merchant name', () => {
  assert.equal(cleanDescription('LOAN PMT 38-9014-0271553-01'), 'Loan Pmt')
  assert.equal(cleanDescription('COVI INSURANCE NZ'), 'Covi Insurance NZ')
  assert.equal(cleanDescription('APPLE.COM/BILL'), 'Apple.com/Bill')
  // Deliberate mixed case is left alone.
  assert.equal(cleanDescription('iTunes Store'), 'iTunes Store')
})
