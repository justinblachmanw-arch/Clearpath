'use strict'
require('dotenv').config()

const { scrapeMlnEmGuide }       = require('./cms/mlnEmGuideScraper')
const { scrapeAwvCompliance }     = require('./cms/awvComplianceScraper')
const { scrapeReviewReasonCodes } = require('./cms/reviewReasonCodesScraper')
const { scrapeTelehealth }        = require('./cms/telehealthScraper')
const { scrapeG2211 }             = require('./cms/g2211Scraper')
const { scrapeNcci }              = require('./cms/ncciScraper')
const { scrapePfs }               = require('./cms/pfsScraper')
const { scrapeLcd }               = require('./cms/lcdScraper')
const { scrapeOigWorkPlan }       = require('./cms/oigWorkPlanScraper')
const { scrapeIdsa }              = require('./tier2/idsaEmScraper')
const { scrapeAmaCpt }            = require('./tier2/amaCptScraper')
const { scrapeAmaFaq }            = require('./tier2/amaFaqScraper')
const { scrapeFcso }              = require('./tier2/fcsoScraper')
const pool                        = require('../lib/db')
const { logScraperRun }           = require('./scraperUtils')

async function runAllCMSScrapers() {
  console.log('[CMS SCRAPERS] Starting all CMS and Tier 2 scrapers...')
  const results = {}

  // CMS direct sources first — establish base records that Tier 2 validates
  const scrapers = [
    ['mlnEmGuide',        scrapeMlnEmGuide],
    ['awvCompliance',     scrapeAwvCompliance],
    ['reviewReasonCodes', scrapeReviewReasonCodes],
    ['telehealth',        scrapeTelehealth],
    ['g2211',             scrapeG2211],
    ['ncci',              scrapeNcci],
    ['pfs',               scrapePfs],
    ['lcd',               scrapeLcd],
    ['oigWorkPlan',       scrapeOigWorkPlan],
    ['idsa',              scrapeIdsa],
    ['amaCpt',            scrapeAmaCpt],
    ['amaFaq',            scrapeAmaFaq],
    ['fcso',              scrapeFcso],
  ]

  for (const [name, fn] of scrapers) {
    console.log(`[CMS SCRAPERS] Running ${name}...`)
    try {
      const start        = Date.now()
      results[name]      = await fn(pool)
      results[name].duration_ms = Date.now() - start
      await logScraperRun(pool, name, results[name])
      console.log(`[CMS SCRAPERS] ${name} complete:`, results[name])
    } catch (err) {
      console.error(`[CMS SCRAPERS] ${name} failed:`, err.message)
      results[name] = { error: err.message }
      await logScraperRun(pool, name, { errors: 1, error_details: { message: err.message } })
    }
  }

  console.log('[CMS SCRAPERS] All done.', results)
  return results
}

module.exports = { runAllCMSScrapers }
