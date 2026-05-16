import initCycleTLS from "cycletls";
import {getSession} from "./cache.js";

let cycleTlsInstance = null;
let initPromise = null;
let idleTimeout = null;

const IDLE_TIMEOUT_MS = 3000;

/**
 * Internal function to reset the kill timer every time the instance is requested.
 */
function resetIdleTimer() {
    // Clear the existing timer if it's running
    if (idleTimeout) {
        clearTimeout(idleTimeout);
    }

    // Start a new 3-second countdown
    idleTimeout = setTimeout(() => {
        if (cycleTlsInstance) {
            const instanceToKill = cycleTlsInstance;

            // Clear references immediately so new requests trigger a fresh initialization
            cycleTlsInstance = null;
            initPromise = null;

            // Kill the process
            instanceToKill.exit().catch(err => {
                console.error("Failed to exit cycleTLS:", err);
            });
        }
    }, IDLE_TIMEOUT_MS);

    // Optional: Prevent this timeout from keeping the Node.js event loop
    // alive if everything else in the script has already finished.
    idleTimeout.unref();
}

/**
 * Returns an active cycleTLS instance.
 * Creates it if it doesn't exist, and resets the 3-second death timer.
 */
async function getCycleTLS() {
    // 1. If we aren't currently initializing, start the process
    if (!initPromise) {
        initPromise = initCycleTLS()
            .then(instance => {
                cycleTlsInstance = instance;
                return instance;
            })
            .catch(err => {
                initPromise = null; // Reset on failure so we can try again
                throw err;
            });
    }

    // 2. Wait for the initialization to finish (or grab the existing one)
    const instance = await initPromise;

    // 3. We are using it now, so reset the idle timer
    resetIdleTimer();

    return instance;
}

async function cycleTLS(url, options, method) {
    const client = await getCycleTLS();
    return client(url, options, method);
}

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

    console.log('fetching', url);

    let response = await cycleTLS(url, {
        timeout: 1000,
        ...options,
        disableRedirect: true,
    }, method);

    console.log('response', response.status);

    if(options.disableRedirect) {
        return response;
    }

    let locationHeader = Object.keys(response.headers).find(header => header.toLowerCase() === 'location');
    let redirectUrl = locationHeader ? response.headers[locationHeader][0] : null;

    while(redirectUrl != null && redirectUrl.length > 0) {
        if (redirectUrl.startsWith('/')) {
            parsedUrl.pathname = redirectUrl;
            redirectUrl = parsedUrl.href;
        }
        console.log("redirectUrl:", redirectUrl);
        response = await cycleTLS(redirectUrl, {
            timeout: 1000,
            ...options,
            disableRedirect: true,
        }, method);

        locationHeader = Object.keys(response.headers).find(header => header.toLowerCase() === 'location');
        redirectUrl = locationHeader ? response.headers[locationHeader][0] : null;
    }

    // cycleTLS.exit().catch(err => {});

    return response;
}

export default async function cf_fetch(url, options={}, method='get') {
    let response = await recursiveFetch(url, {
        ...options,
        // ja3: '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0', // https://scrapfly.io/web-scraping-tools/ja3-fingerprint
    }, method);

    if(!isCloudflareChallenge(await response.text())) {
        return response;
    }

    const session = await getSession(url, options);

    if (!session || session.code != 200) return console.error(session);

    console.log(session);

    // TODO: merge cookies and headers

    response = await recursiveFetch(url, {
        ...options,
        // https://scrapfly.io/web-scraping-tools/ja3-fingerprint
        ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,18-16-11-27-17613-35-23-0-45-65281-13-43-5-65037-10-51-41,4588-29-23-24,0',
        ja4r: 't13d1517h2_002f,0035,009c,009d,1301,1302,1303,c013,c014,c02b,c02c,c02f,c030,cca8,cca9_0005,000a,000b,000d,0012,0017,001b,0023,0029,002b,002d,0033,44cd,fe0d,ff01_0403,0804,0401,0503,0805,0501,0806,0601',
        http2Fingerprint: '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p',
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36", // session.headers["user-agent"],
        headers: {
            ...options.headers,
            ...session.headers,
            cookie: [
                ...(options.cookies ?? []),
                ...session.cookies
            ].map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
        },
    }, method);

    console.log(await response.text());

    return response;
}

// cf_fetch('https://nopecha.com/demo/cloudflare');