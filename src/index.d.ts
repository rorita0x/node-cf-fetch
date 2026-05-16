import {CycleTLSRequestOptions, CycleTLSResponse} from "cycletls";

export type HeaderData = Record<string, string>;
export type CookieData = Array<Record<string, string>> | { [key: string]: string };

export default function cf_fetch(url: string, options?: CycleTLSRequestOptions, method?: string): CycleTLSResponse;