require('./config/config')
const BOOKS = require('./config/books').books

const express = require('express')
const bodyParser = require('body-parser')
const rateLimit = require("express-rate-limit");
const puppeteer = require('puppeteer')
const jsdom = require('jsdom')
const { JSDOM } = jsdom

const elementsLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: 'One user is limited to 10 requests every 5 minutes.',
})

var app = express()
const port = process.env.PORT

app.use('/books', express.static('books'))
app.use(bodyParser.json())
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    //res.setHeader('Access-Control-Allow-Origin', 'http://katalysteducation.pl')
	res.setHeader('Access-Control-Allow-Origin', '*')

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Cache-Control')

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', false)

    // Pass to next layer of middleware
    next()
})

/////////////////////////////////
/////////////////////////////////
/////////////////////////////////
// GET ROUTES
/////////////////////////////////
/////////////////////////////////
/////////////////////////////////

app.get('/', (req, res) => {
    console.log('GET /')
    try {
        res.send({status: 'active'})
    } catch (e) {
        res.status(500).send(e)
    }
})

app.get('/books', (req, res) => {
    console.log('GET /books')
    try {
        res.send(BOOKS)
    } catch (e) {
        res.status(500).send(e)
    }
})

const PAGE_LOAD_TIME = 10 * 60 * 1000 // Wait 10 minutes before timing out (large books take a long time to open)

// Status codes
const STATUS_CODE = {
  OK: 0,
  ERROR: 111
}

const getResults = async (selector, url) => {
    try {
        const browser = await puppeteer.launch({
            args: ['--no-sandbox']
        })
        const page = await browser.newPage()
        
        page.on('pageerror', msgText => {
            //console.log('browser-ERROR', msgText)
            return STATUS_CODE.ERROR
        })

        await page.setRequestInterception(true)
	
        page.on('request', request => {
            if (
                request.resourceType() === 'image' || 
                request.resourceType() === 'script' ||
                request.resourceType() === 'sub_frame' ||
                request.resourceType() === 'other'
                ) {
                request.abort()
            } else {
                request.continue()
            }
        })

        console.log(`Opening "${url}"`)
        await page.goto(url, {
        timeout: PAGE_LOAD_TIME
        })
        console.log(`Opened "${url}"`)

        const results = await page.evaluate((selector) => {
            const pages = document.querySelectorAll('[data-type="composite-page"], [data-type="page"]')
            console.log(`Found ${Object.entries(pages).length} pages.`)

            const results = []
            Object.entries(pages).forEach(el => {
                const [id, page] = el
                let title = page.querySelector('*:not([data-type="metadata"]) > [data-type="document-title"]')
                if (title) {
                    if (!title.querySelector('.os-number')) {
                        const chapterNumber = title.parentNode.parentNode.querySelector('h1[data-type="document-title"] .os-number')
                        const chapterTitle = title.parentNode.parentNode.querySelector('h1[data-type="document-title"]').innerText
                        if (chapterNumber) {
                            title = chapterNumber.innerText + ' ' + title.innerText
                        } else if (chapterTitle && chapterTitle !== 'Preface') {
                            title = 'Chapter: ' + chapterTitle + ' Module: ' + title.innerText
                        } else {
                            title = title.innerText
                        }
                    } else {
                        title = title.innerText
                    }
                }

                let isSelectorInThisPage = false

                if (selector.match(':hasText')) {
                    const splitAtHasText = selector.split(':hasText') // .howto:hasText(Step)

                    if (splitAtHasText.length > 2) {
                        throw new Error('We do not support nested :hasText selector.')
                    }

                    let [left, text] = splitAtHasText // .howto | (Step)
                    right = text.slice(1, -1) // remove ()

                    const parentElements = page.querySelectorAll(left)
                    isSelectorInThisPage = [...parentElements].filter(el => {
                        if (el.innerText.match(text)) {
                            return true
                        } else {
                            return false
                        }
                    })

                } else if (selector.match(':has')) {
                    const splitAtHas = selector.split(':has') // table:has(img)

                    if (splitAtHas.length > 2) {
                        throw new Error('We do not support nested :has selector.')
                    }

                    let [left, right] = splitAtHas // table | (img)
                    right = right.slice(1, -1) // remove ()

                    const parentElements = page.querySelectorAll(left)
                    isSelectorInThisPage = [...parentElements].filter(el => {
                        if (el.querySelector(right)) {
                            return true
                        } else {
                            return false
                        }
                    })
                } else {
                    isSelectorInThisPage = page.querySelectorAll(selector)
                }

                if (isSelectorInThisPage.length > 0) {
                    results.push({section_name: title, link: null, instances: isSelectorInThisPage.length})
                }
            })

            return results
        }, selector)

        await browser.close()

        console.log(`Found ${results.length} pages with given selector (${selector}).`)

        return results
    } catch (e) {
        console.log(e)
        throw new Error(`Something went wrong. Details: ${e}`)
    }
}

const isSelectorValid = async (selector) => {
    let success = {
        status: true,
        message: 'OK',
    }

    if (!selector) {
        console.log(`You have to provide selector.`)
        return {
            status: false,
            message: 'You have to provide selector.',
        }
    }
  
    try {
        const dom = await new JSDOM()
        const splitAtHas = await selector.split(':has')
        if (selector.match(':hasText')) {
            return success
        }
        if (await selector.match(':has')) {
            if (splitAtHas.length > 2) {
                throw new Error('We do not support nested :has selector.')
            }

            let [left, right] = splitAtHas // table | (img)
            right = right.slice(1, -1) // remove ()

            await dom.window.document.querySelector(left)
            await dom.window.document.querySelector(right)

            return success
        } else {
            await dom.window.document.querySelector(selector) // this will throw Error if fails
            return success
        }
    } catch(e) {
        console.log(`Provided selector: "${selector}" is not valid.\nDetails: ${e}`)
        return {
            status: false,
            message: `Provided selector: "${selector}" is not valid.`,
        }
    }
}

app.get('/elements', elementsLimiter, async (req, res) => {
    req.connection.setTimeout(7 * 60 * 1000) // 7 minutes - Opening books may take a lot of time

    console.log(new Date(), 'GET /elements', req.query)
    try {
        const bookName = req.query.bookName.replace(/_/g, ' ')
        const selector = req.query.element.replace(/\'/g, '"')

        let requestedBook = {}

        BOOKS.some(book => {
            if (book.bookName === bookName) {
                requestedBook = book
                return true
            }
        })

        if (!requestedBook.fileName) {
            console.log(`Couldn't find any book with name: ${bookName}. Maybe this book is not yet avaible for searching custom elements.`)
            throw new Error(`Couldn't find any book with name: ${bookName}. Maybe this book is not yet avaible for searching custom elements.`)
        }

        let results = []

        const pathToFile = process.env.PATH_TO_BOOKS + requestedBook.fileName
        const validatedSelector = await isSelectorValid(selector)
        if (validatedSelector.status) {
            console.log(`Starting searching for "${selector}" inside "${requestedBook.fileName}"`)

            results = await getResults(selector, pathToFile)
        } else {
            throw new Error(validatedSelector.message)
        }

        res.send({Results: results, ...requestedBook})
    } catch (e) {
        console.log(e)
        res.status(500).send(e.message)
    }
})

app.listen(port, () => {
    console.log(`Started on port ${port}`)
})

module.exports = {app}
