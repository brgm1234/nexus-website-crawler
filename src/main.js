const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        startUrls = [{ url: 'https://example.com' }],
        maxRequestsPerCrawl = 100,
        maxConcurrency = 5,
        proxyConfiguration = {
            useApifyProxy: true,
            apifyProxyGroups: ['BUYPROXIES94952'],
        },
    } = input;

    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxRequestsPerCrawl,
        maxConcurrency,
        headless: true,
        launchContext: {
            launchOptions: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        },
        requestHandlerTimeoutSecs: 120,

        async requestHandler({ request, page, enqueueLinks, log }) {
            const { url } = request;
            log.info('Processing page', { url });

            // Wait for page to load
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

            // Extract page title
            const title = await page.title();

            // Extract main content
            const content = await page.evaluate(() => {
                const body = document.body;
                if (!body) return '';
                // Remove scripts and styles
                const clone = body.cloneNode(true);
                clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
                return clone.innerText.trim().substring(0, 10000);
            });

            // Extract all links
            const links = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(a => ({ text: a.innerText.trim(), href: a.href }))
                    .filter(l => l.href.startsWith('http'))
                    .slice(0, 100);
            });

            // Extract meta information
            const meta = await page.evaluate(() => {
                const getMeta = (name) => {
                    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                    return el ? el.getAttribute('content') : null;
                };
                return {
                    description: getMeta('description') || getMeta('og:description'),
                    image: getMeta('og:image'),
                    type: getMeta('og:type'),
                };
            });

            // Store results
            await Dataset.pushData({
                url,
                title,
                content: content.substring(0, 5000),
                links: links.slice(0, 50),
                meta,
                scrapedAt: new Date().toISOString(),
            });

            // Enqueue more links from the same domain
            await enqueueLinks({
                strategy: 'same-domain',
                transformRequestFunction: (req) => {
                    req.userData = { depth: (request.userData?.depth || 0) + 1 };
                    if (req.userData.depth > 3) return false;
                    return req;
                },
            });
        },

        async failedRequestHandler({ request, log }) {
            log.error('Request failed', { url: request.url, errors: request.errorMessages });
            await Dataset.pushData({
                url: request.url,
                title: 'FAILED',
                error: request.errorMessages.join(', '),
                scrapedAt: new Date().toISOString(),
            });
        },
    });

    const requests = startUrls.map(urlObj => ({
        url: typeof urlObj === 'string' ? urlObj : urlObj.url,
        userData: { depth: 0 },
    }));

    await crawler.run(requests);

    console.log('Crawl finished. Results saved to dataset.');
});
