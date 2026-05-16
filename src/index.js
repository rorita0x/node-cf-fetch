import initCycleTLS from "cycletls";

/**
 * Checks if a given HTML string is a Cloudflare challenge page.
 *
 * @param {string} htmlString - The HTML string to check.
 * @returns {boolean} - Returns true if Cloudflare markers are found.
 */
function isCloudflareChallenge(htmlString) {
    // Regex looks for the Cloudflare challenge options object or the challenge script path
    const cfRegex = /window\._cf_chl_opt|\/cdn-cgi\/challenge-platform\//i;

    return cfRegex.test(htmlString);
}

/**
 *
 * @param url
 * @param options
 * @param method
 * @returns {Promise<CycleTLSResponse>}
 */
async function recursiveFetch(url, options, method = "get") {
    const parsedUrl = new URL(url);
    const cycleTLS = await initCycleTLS();

    let response = await cycleTLS(url, {
        ...options,
        disableRedirect: true,
        responseType: "text",
    }, method);

    let locationHeader = Object.keys(response.headers).find(header => header.toLowerCase() === 'location');
    let redirectUrl = locationHeader ? response.headers[locationHeader][0] : null;

    while(redirectUrl != null && redirectUrl.length > 0) {
        console.log("redirectUrl", redirectUrl);
        if (redirectUrl.startsWith('/')) {
            parsedUrl.pathname = redirectUrl;
            redirectUrl = parsedUrl.href;
        }
        console.log(redirectUrl);
        response = await cycleTLS(redirectUrl, {
            ...options,
            disableRedirect: true,
            responseType: "text",
        }, method);

        locationHeader = Object.keys(response.headers).find(header => header.toLowerCase() === 'location');
        redirectUrl = locationHeader ? response.headers[locationHeader][0] : null;
    }

    return response;
}

export async function cf_fetch(url, options={}, method='get') {
    const cycleTLS = await initCycleTLS();

    let response = await recursiveFetch(url, {
        ...options.headers,
        // ja3: '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0', // https://scrapfly.io/web-scraping-tools/ja3-fingerprint
    }, method);

    cycleTLS.exit().catch(err => {});

    if(!isCloudflareChallenge(await response.text())) {
        return response;
    }

    const session = await fetch('http://localhost:3000/cf-clearance-scraper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            url: url,
            mode: "waf-session",
            proxy: options?.proxy,
        })
    }).then(res => res.json()).catch(err => { console.error(err); return null });

    if (!session || session.code != 200) return console.error(session);

    // TODO: merge cookies and headers

    response = await recursiveFetch(url, {
        ...options,
        // ja3: '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0', // https://scrapfly.io/web-scraping-tools/ja3-fingerprint        ...options,
        userAgent: session.headers["user-agent"],
        headers: {
            ...options.headers,
            ...session.headers,
            cookie: session.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        }
    }, method);

    cycleTLS.exit().catch(err => { });

    return response;
}
cf_fetch('https://nopecha.com/demo/cloudflare');