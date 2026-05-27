'use strict'
require('dotenv').config()

const { runTestMode, runYoutubeScraper } = require('./youtubePipeline')

module.exports = { runTestMode, runYoutubeScraper }
