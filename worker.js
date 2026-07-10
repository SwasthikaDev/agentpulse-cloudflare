// AgentPulse (Cloudflare Worker) — signed, real-time liveness for the NANDA agent web.
//
// Single file, zero npm dependencies:
//   * probing runs in a Cron Trigger, in batches, to respect the free-tier
//     subrequest limit; results are cached in Workers KV (binding: PULSE_KV).
//   * the HTTP handler only reads KV, so every response is instant.
//   * answers are Ed25519-signed via Web Crypto (crypto.subtle); POST /verify
//     confirms a signature, so callers never have to trust us.
//
// KV snapshot shape:
//   { checked_at, cursor, records:[{id,name,url}], status:{ [id]:{up,latency_ms,http} } }

const REGISTRY_URL = "https://nandatown.projectnanda.org/api/skills";
const UA = "AgentPulse/1.0 (Cloudflare Worker; liveness probe)";
const PROBE_TIMEOUT_MS = 5000;
const BATCH = 45; // registry fetch (1) + BATCH probes must stay under the 50 subrequest cap

const BOARD_B64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xIj4KPHRpdGxlPkFnZW50UHVsc2Ug4oCUIGlzIHRoZSBhZ2VudCB3ZWIgYWxpdmU/PC90aXRsZT4KPG1ldGEgbmFtZT0iZGVzY3JpcHRpb24iIGNvbnRlbnQ9IkxpdmUsIHNpZ25lZCB1cHRpbWUgZm9yIGV2ZXJ5IGFnZW50IGluIHRoZSBOQU5EQSByZWdpc3RyeS4gU2VlIHdoaWNoIGFnZW50cyBhY3R1YWxseSBhbnN3ZXIgcmlnaHQgbm93LiI+CjxsaW5rIHJlbD0iaWNvbiIgaHJlZj0iZGF0YTppbWFnZS9zdmcreG1sLCUzQ3N2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJyUzRSUzQ3RleHQgeT0nLjllbScgZm9udC1zaXplPSc5MCclM0UlRjAlOUYlOTIlOTMlM0MvdGV4dCUzRSUzQy9zdmclM0UiPgo8c3R5bGU+CiAgOnJvb3R7CiAgICAtLWJnOiMwZDExMTc7IC0tcGFuZWw6IzEzMWMyNjsgLS1wYW5lbC0yOiMwZjE3MjA7IC0tbGluZTojMjMzMjQwOwogICAgLS10ZXh0OiNlOGVlZjQ7IC0tbXV0ZWQ6IzkzYTZiNDsgLS1mYWludDojNWY3MjgwOwogICAgLS11cDojM2ZiOTZiOyAtLWRvd246I2UyNjA0YTsgLS11bms6IzdjOGE5NzsgLS1hY2NlbnQ6I2U3YTMzZjsKICAgIC0tbW9ubzp1aS1tb25vc3BhY2UsIkNhc2NhZGlhIENvZGUiLCJTRiBNb25vIiwiSmV0QnJhaW5zIE1vbm8iLE1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTsKICAgIC0tc2FuczpzeXN0ZW0tdWksLWFwcGxlLXN5c3RlbSwiU2Vnb2UgVUkiLFJvYm90bywiSGVsdmV0aWNhIE5ldWUiLEFyaWFsLHNhbnMtc2VyaWY7CiAgfQogICp7Ym94LXNpemluZzpib3JkZXItYm94fQogIGJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdGV4dCk7Zm9udC1mYW1pbHk6dmFyKC0tc2Fucyk7bGluZS1oZWlnaHQ6MS42OwogICAgYmFja2dyb3VuZC1pbWFnZTpyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDE1JSAtMTAlLCByZ2JhKDIzMSwxNjMsNjMsLjA4KSwgdHJhbnNwYXJlbnQgNDAlKSxyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDEwMCUgMCUsIHJnYmEoNjMsMTg1LDEwNywuMDcpLCB0cmFuc3BhcmVudCAzNSUpfQogIC53cmFwe21heC13aWR0aDoxMDgwcHg7bWFyZ2luOjAgYXV0bztwYWRkaW5nOjAgMjJweH0KICBoZWFkZXJ7cGFkZGluZzo1NnB4IDAgMjJweH0KICAuZXllYnJvd3tmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjcycmVtO2xldHRlci1zcGFjaW5nOi4yZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLWFjY2VudCl9CiAgaDF7Zm9udC1zaXplOmNsYW1wKDJyZW0sNS41dncsMy4zcmVtKTtmb250LXdlaWdodDo4NTA7bGV0dGVyLXNwYWNpbmc6LS4wM2VtO21hcmdpbjoxMnB4IDAgMTBweDtsaW5lLWhlaWdodDoxfQogIC5zdWJ7Y29sb3I6dmFyKC0tbXV0ZWQpO21heC13aWR0aDo2NDBweDtmb250LXNpemU6MS4wOHJlbX0KICAuaGVhZGxpbmV7bWFyZ2luOjI2cHggMCA2cHg7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOmNsYW1wKDFyZW0sMi40dncsMS4zNXJlbSk7Zm9udC13ZWlnaHQ6NjAwfQogIC5oZWFkbGluZSBie2NvbG9yOnZhcigtLWFjY2VudCl9CiAgLm1ldGF7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43OHJlbTtjb2xvcjp2YXIoLS1mYWludCk7ZGlzcGxheTpmbGV4O2dhcDoxNnB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcn0KICAuZG90cHVsc2V7d2lkdGg6OHB4O2hlaWdodDo4cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS11cCk7ZGlzcGxheTppbmxpbmUtYmxvY2s7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywuNik7YW5pbWF0aW9uOnB1bHNlIDIuNHMgaW5maW5pdGV9CiAgQGtleWZyYW1lcyBwdWxzZXswJXtib3gtc2hhZG93OjAgMCAwIDAgcmdiYSg2MywxODUsMTA3LC41KX03MCV7Ym94LXNoYWRvdzowIDAgMCA3cHggcmdiYSg2MywxODUsMTA3LDApfTEwMCV7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywwKX19CiAgQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOiByZWR1Y2Upey5kb3RwdWxzZXthbmltYXRpb246bm9uZX19CgogIC5zdGF0c3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTUwcHgsMWZyKSk7Z2FwOjE0cHg7bWFyZ2luOjI2cHggMCA4cHh9CiAgLmNhcmR7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxOHB4IDIwcHh9CiAgLmNhcmQgLm57Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC13ZWlnaHQ6ODAwO2ZvbnQtc2l6ZToyLjFyZW07bGV0dGVyLXNwYWNpbmc6LS4wMmVtO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc30KICAuY2FyZCAua3tjb2xvcjp2YXIoLS1tdXRlZCk7Zm9udC1zaXplOi44NXJlbTttYXJnaW4tdG9wOjJweH0KICAuY2FyZC51cCAubntjb2xvcjp2YXIoLS11cCl9IC5jYXJkLmRvd24gLm57Y29sb3I6dmFyKC0tZG93bil9IC5jYXJkLnVuayAubntjb2xvcjp2YXIoLS11bmspfSAuY2FyZC50b3RhbCAubntjb2xvcjp2YXIoLS10ZXh0KX0KCiAgLmJhcntkaXNwbGF5OmZsZXg7aGVpZ2h0OjEycHg7Ym9yZGVyLXJhZGl1czo3cHg7b3ZlcmZsb3c6aGlkZGVuO21hcmdpbjoxOHB4IDAgNHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSl9CiAgLmJhciBpe2Rpc3BsYXk6YmxvY2s7aGVpZ2h0OjEwMCV9CiAgLmJhciAuYi11cHtiYWNrZ3JvdW5kOnZhcigtLXVwKX0gLmJhciAuYi1kb3due2JhY2tncm91bmQ6dmFyKC0tZG93bil9IC5iYXIgLmItdW5re2JhY2tncm91bmQ6dmFyKC0tdW5rKX0KCiAgc2VjdGlvbntwYWRkaW5nOjI2cHggMCA0MHB4fQogIC5yb3d7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmJhc2VsaW5lO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDoxMnB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTRweH0KICBoMntmb250LXNpemU6MS4xNXJlbTttYXJnaW46MH0KICAuZmlsdGVyYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjhweDtmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6Ljc2cmVtfQogIC5maWx0ZXJidG5zIGJ1dHRvbntiYWNrZ3JvdW5kOnZhcigtLXBhbmVsKTtjb2xvcjp2YXIoLS1tdXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6NXB4IDEycHg7Y3Vyc29yOnBvaW50ZXJ9CiAgLmZpbHRlcmJ0bnMgYnV0dG9uW2FyaWEtcHJlc3NlZD0idHJ1ZSJde2NvbG9yOnZhcigtLXRleHQpO2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5ncmlke2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZmlsbCxtaW5tYXgoMjMwcHgsMWZyKSk7Z2FwOjEwcHh9CiAgLmFnZW50e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjExcHg7YmFja2dyb3VuZDp2YXIoLS1wYW5lbC0yKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCB2YXIoLS11bmspO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTBweCAxM3B4fQogIC5hZ2VudC51cHtib3JkZXItbGVmdC1jb2xvcjp2YXIoLS11cCl9IC5hZ2VudC5kb3due2JvcmRlci1sZWZ0LWNvbG9yOnZhcigtLWRvd24pfQogIC5hZ2VudCAuZG90e3dpZHRoOjlweDtoZWlnaHQ6OXB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tdW5rKTtmbGV4Om5vbmV9CiAgLmFnZW50LnVwIC5kb3R7YmFja2dyb3VuZDp2YXIoLS11cCl9IC5hZ2VudC5kb3duIC5kb3R7YmFja2dyb3VuZDp2YXIoLS1kb3duKX0KICAuYWdlbnQgLm5te2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6LjkycmVtO3doaXRlLXNwYWNlOm5vd3JhcDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpcztmbGV4OjE7bWluLXdpZHRoOjB9CiAgLmFnZW50IC5sYXR7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43MnJlbTtjb2xvcjp2YXIoLS1mYWludCk7d2hpdGUtc3BhY2U6bm93cmFwfQogIC5sb2FkaW5ne2NvbG9yOnZhcigtLW11dGVkKTtmb250LWZhbWlseTp2YXIoLS1tb25vKTtwYWRkaW5nOjMwcHggMH0KICAuc3ViMntmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6Ljc0cmVtO2NvbG9yOnZhcigtLWZhaW50KX0KICAuZnJlc2h7bWFyZ2luOjE2cHggMCA0cHg7cGFkZGluZzoxM3B4IDE2cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItbGVmdDozcHggc29saWQgdmFyKC0tYWNjZW50KTtib3JkZXItcmFkaXVzOjAgOXB4IDlweCAwO2JhY2tncm91bmQ6dmFyKC0tcGFuZWwpO2ZvbnQtc2l6ZTouOTVyZW19CiAgLmZyZXNoIGJ7Y29sb3I6dmFyKC0tYWNjZW50KX0KICAuaW5je2Rpc3BsYXk6Z3JpZDtnYXA6NnB4fQogIC5pbmNyb3d7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczo5NnB4IDFmciBhdXRvO2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweDtiYWNrZ3JvdW5kOnZhcigtLXBhbmVsLTIpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czo4cHg7cGFkZGluZzo4cHggMTNweDtmb250LXNpemU6LjlyZW19CiAgLmluY3JvdyAudGFne2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2ZvbnQtc2l6ZTouNjZyZW07Zm9udC13ZWlnaHQ6NzAwO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouMDVlbTtwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czo5OTlweDt0ZXh0LWFsaWduOmNlbnRlcn0KICAuaW5jcm93LmRvd24gLnRhZ3tiYWNrZ3JvdW5kOmNvbG9yLW1peChpbiBzcmdiLHZhcigtLWRvd24pIDIyJSx0cmFuc3BhcmVudCk7Y29sb3I6dmFyKC0tZG93bil9CiAgLmluY3Jvdy5yZWNvdmVyZWQgLnRhZ3tiYWNrZ3JvdW5kOmNvbG9yLW1peChpbiBzcmdiLHZhcigtLXVwKSAyMiUsdHJhbnNwYXJlbnQpO2NvbG9yOnZhcigtLXVwKX0KICAuaW5jcm93IC5ubXtmb250LXdlaWdodDo2MDA7d2hpdGUtc3BhY2U6bm93cmFwO292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO21pbi13aWR0aDowfQogIC5pbmNyb3cgLmFnb3tmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjcycmVtO2NvbG9yOnZhcigtLWZhaW50KX0KICAubGJ7ZGlzcGxheTpncmlkO2dhcDo2cHh9CiAgLmxicm93e2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MzBweCAxZnIgMTMwcHggNzhweDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHg7YmFja2dyb3VuZDp2YXIoLS1wYW5lbC0yKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6OXB4IDEzcHh9CiAgLmxicm93IC5yYW5re2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1mYWludCk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQogIC5sYnJvdy50b3AxIC5yYW5re2NvbG9yOnZhcigtLWFjY2VudCl9IC5sYnJvdy50b3AyIC5yYW5re2NvbG9yOiNjOWQzZGJ9IC5sYnJvdy50b3AzIC5yYW5re2NvbG9yOiNjZDhiNWF9CiAgLmxicm93IC5ubXtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOi45MnJlbTt3aGl0ZS1zcGFjZTpub3dyYXA7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O21pbi13aWR0aDowfQogIC5sYnJvdyAubm0gLmR7d2lkdGg6OHB4O2hlaWdodDo4cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS11bmspO2ZsZXg6bm9uZX0KICAubGJyb3cuaXN1cCAubm0gLmR7YmFja2dyb3VuZDp2YXIoLS11cCl9IC5sYnJvdy5pc2Rvd24gLm5tIC5ke2JhY2tncm91bmQ6dmFyKC0tZG93bil9CiAgLmxicm93IC50cmFja3toZWlnaHQ6OHB4O2JvcmRlci1yYWRpdXM6NXB4O2JhY2tncm91bmQ6dmFyKC0tcGFuZWwpO292ZXJmbG93OmhpZGRlbjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpfQogIC5sYnJvdyAudHJhY2sgaXtkaXNwbGF5OmJsb2NrO2hlaWdodDoxMDAlO2JhY2tncm91bmQ6dmFyKC0tdXApfQogIC5sYnJvdyAucGN0e2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2ZvbnQtc2l6ZTouODJyZW07Zm9udC13ZWlnaHQ6NzAwO3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQogIC5sYnJvdyAubGF0Mntmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjdyZW07Y29sb3I6dmFyKC0tZmFpbnQpfQogIEBtZWRpYSAobWF4LXdpZHRoOjYyMHB4KXsgLmxicm93e2dyaWQtdGVtcGxhdGUtY29sdW1uczoyNnB4IDFmciA2MHB4fSAubGJyb3cgLnRyYWNre2Rpc3BsYXk6bm9uZX0gfQoKICBmb290ZXJ7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tbGluZSk7cGFkZGluZzoyNnB4IDAgNjBweDtjb2xvcjp2YXIoLS1mYWludCk7Zm9udC1zaXplOi44NXJlbTtmb250LWZhbWlseTp2YXIoLS1tb25vKX0KICBmb290ZXIgYXtjb2xvcjp2YXIoLS1hY2NlbnQpO3RleHQtZGVjb3JhdGlvbjpub25lfQogIGNvZGV7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjVweDtwYWRkaW5nOjFweCA2cHg7Zm9udC1zaXplOi44NWVtfQo8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5PgogIDxkaXYgY2xhc3M9IndyYXAiPgogICAgPGhlYWRlcj4KICAgICAgPGRpdiBjbGFzcz0iZXllYnJvdyI+VXB0aW1lIGZvciB0aGUgYWdlbnQgd2ViPC9kaXY+CiAgICAgIDxoMT5BZ2VudCYjODIwMjtQdWxzZTwvaDE+CiAgICAgIDxwIGNsYXNzPSJzdWIiPlRoZSBOQU5EQSByZWdpc3RyeSBsaXN0cyBtYW55IGFnZW50cywgYnV0IHlvdSBjYW4ndCB0ZWxsIHdoaWNoIG9uZXMgYWN0dWFsbHkgYW5zd2VyLiBBZ2VudFB1bHNlIGNoZWNrcyBldmVyeSBvbmUgYXQgaXRzIHJlYWwgZW5kcG9pbnQsIGZpcnN0LWhhbmQsIGFuZCBzaWducyB0aGUgcmVzdWx0IHNvIHlvdSBjYW4gdmVyaWZ5IGl0LjwvcD4KICAgICAgPGRpdiBjbGFzcz0iaGVhZGxpbmUiIGlkPSJoZWFkbGluZSI+Q2hlY2tpbmcgdGhlIGFnZW50IHdlYuKApjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJtZXRhIj4KICAgICAgICA8c3Bhbj48c3BhbiBjbGFzcz0iZG90cHVsc2UiPjwvc3Bhbj4gbGl2ZSBwcm9iZTwvc3Bhbj4KICAgICAgICA8c3BhbiBpZD0iY2hlY2tlZEF0Ij5sYXN0IGNoZWNrZWQ6IOKAlDwvc3Bhbj4KICAgICAgICA8c3Bhbj5zaWduZWQgwrcgdmVyaWZ5IGF0IDxjb2RlPi92ZXJpZnk8L2NvZGU+PC9zcGFuPgogICAgICA8L2Rpdj4KICAgIDwvaGVhZGVyPgoKICAgIDxkaXYgY2xhc3M9InN0YXRzIiBpZD0ic3RhdHMiPgogICAgICA8ZGl2IGNsYXNzPSJjYXJkIHRvdGFsIj48ZGl2IGNsYXNzPSJuIiBpZD0icy10b3RhbCI+4oCUPC9kaXY+PGRpdiBjbGFzcz0iayI+cmVnaXN0ZXJlZCBhZ2VudHM8L2Rpdj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZCB1cCI+PGRpdiBjbGFzcz0ibiIgaWQ9InMtdXAiPuKAlDwvZGl2PjxkaXYgY2xhc3M9ImsiPnJlYWNoYWJsZSBub3c8L2Rpdj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZCBkb3duIj48ZGl2IGNsYXNzPSJuIiBpZD0icy1kb3duIj7igJQ8L2Rpdj48ZGl2IGNsYXNzPSJrIj5ub3QgYW5zd2VyaW5nPC9kaXY+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNhcmQgdW5rIj48ZGl2IGNsYXNzPSJuIiBpZD0icy11bmsiPuKAlDwvZGl2PjxkaXYgY2xhc3M9ImsiPm5vIGVuZHBvaW50IHRvIGNoZWNrPC9kaXY+PC9kaXY+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImJhciIgaWQ9ImJhciIgYXJpYS1oaWRkZW49InRydWUiPjwvZGl2PgoKICAgIDxkaXYgY2xhc3M9ImZyZXNoIiBpZD0iZnJlc2giIGhpZGRlbj48L2Rpdj4KCiAgICA8c2VjdGlvbj4KICAgICAgPGRpdiBjbGFzcz0icm93Ij4KICAgICAgICA8aDI+TW9zdCByZWxpYWJsZSBhZ2VudHM8L2gyPgogICAgICAgIDxzcGFuIGNsYXNzPSJzdWIyIj5yYW5rZWQgYnkgdHJhY2tlZCB1cHRpbWUsIHRoZW4gc3BlZWQ8L3NwYW4+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJsYiIgaWQ9ImxiIj48ZGl2IGNsYXNzPSJsb2FkaW5nIj5CdWlsZGluZyB0aGUgdHJhY2sgcmVjb3Jk4oCmPC9kaXY+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24+CiAgICAgIDxkaXYgY2xhc3M9InJvdyI+CiAgICAgICAgPGgyPlJlY2VudCBpbmNpZGVudHM8L2gyPgogICAgICAgIDxzcGFuIGNsYXNzPSJzdWIyIj51cCAvIGRvd24gY2hhbmdlcyB3ZSBjYXVnaHQ8L3NwYW4+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJpbmMiIGlkPSJpbmMiPjxkaXYgY2xhc3M9ImxvYWRpbmciPldhdGNoaW5nIGZvciBzdGF0ZSBjaGFuZ2Vz4oCmPC9kaXY+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPHNlY3Rpb24+CiAgICAgIDxkaXYgY2xhc3M9InJvdyI+CiAgICAgICAgPGgyPkV2ZXJ5IHJlZ2lzdGVyZWQgYWdlbnQ8L2gyPgogICAgICAgIDxkaXYgY2xhc3M9ImZpbHRlcmJ0bnMiIGlkPSJmaWx0ZXJzIj4KICAgICAgICAgIDxidXR0b24gZGF0YS1mPSJhbGwiIGFyaWEtcHJlc3NlZD0idHJ1ZSI+YWxsPC9idXR0b24+CiAgICAgICAgICA8YnV0dG9uIGRhdGEtZj0idXAiIGFyaWEtcHJlc3NlZD0iZmFsc2UiPnJlYWNoYWJsZTwvYnV0dG9uPgogICAgICAgICAgPGJ1dHRvbiBkYXRhLWY9ImRvd24iIGFyaWEtcHJlc3NlZD0iZmFsc2UiPmRvd248L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImdyaWQiIGlkPSJncmlkIj48ZGl2IGNsYXNzPSJsb2FkaW5nIj5Mb2FkaW5nIHRoZSByZWdpc3RyeeKApjwvZGl2PjwvZGl2PgogICAgPC9zZWN0aW9uPgoKICAgIDxmb290ZXI+CiAgICAgIEFnZW50UHVsc2Ugwrcgc2lnbmVkIGxpdmVuZXNzIEFQSSDigJQgPGEgaHJlZj0iL3NraWxsLm1kIj4vc2tpbGwubWQ8L2E+IMK3IDxhIGhyZWY9Ii9zdGF0dXMiPi9zdGF0dXM8L2E+IMK3IDxhIGhyZWY9Ii9sZWFkZXJib2FyZCI+L2xlYWRlcmJvYXJkPC9hPiDCtyA8YSBocmVmPSIvbGl2ZSI+L2xpdmU8L2E+PGJyPgogICAgICBCdWlsdCBieSA8YSBocmVmPSJodHRwczovL2dpdGh1Yi5jb20vU3dhc3RoaWthRGV2Ij5AU3dhc3RoaWthRGV2PC9hPiBmb3IgdGhlIE5BTkRBIGFnZW50IHdlYi4KICAgIDwvZm9vdGVyPgogIDwvZGl2PgoKPHNjcmlwdD4KICB2YXIgQUxMID0gW10sIGZpbHRlciA9ICJhbGwiOwogIGZ1bmN0aW9uIGZtdEFnbyh0cyl7IGlmKCF0cykgcmV0dXJuICLigJQiOyB2YXIgcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoRGF0ZS5ub3coKS8xMDAwIC0gdHMpKTsKICAgIGlmKHM8NjApIHJldHVybiBzKyJzIGFnbyI7IGlmKHM8MzYwMCkgcmV0dXJuIE1hdGguZmxvb3Iocy82MCkrIm0gYWdvIjsgcmV0dXJuIE1hdGguZmxvb3Iocy8zNjAwKSsiaCBhZ28iOyB9CiAgZnVuY3Rpb24gcmVuZGVyKCl7CiAgICB2YXIgZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJncmlkIik7CiAgICB2YXIgbGlzdCA9IEFMTC5maWx0ZXIoZnVuY3Rpb24oYSl7IHJldHVybiBmaWx0ZXI9PT0iYWxsIiB8fCAoZmlsdGVyPT09InVwIj8gYS51cD09PXRydWUgOiBhLnVwIT09dHJ1ZSk7IH0pOwogICAgbGlzdC5zb3J0KGZ1bmN0aW9uKGEsYil7IHZhciByPShiLnVwPT09dHJ1ZSktKGEudXA9PT10cnVlKTsgcmV0dXJuIHIgfHwgKGEubmFtZXx8IiIpLmxvY2FsZUNvbXBhcmUoYi5uYW1lfHwiIik7IH0pOwogICAgaWYoIWxpc3QubGVuZ3RoKXsgZy5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0ibG9hZGluZyI+Tm8gYWdlbnRzIGluIHRoaXMgdmlldy48L2Rpdj4nOyByZXR1cm47IH0KICAgIGcuaW5uZXJIVE1MID0gbGlzdC5tYXAoZnVuY3Rpb24oYSl7CiAgICAgIHZhciBjbHMgPSBhLnVwPT09dHJ1ZSA/ICJ1cCIgOiBhLnVwPT09ZmFsc2UgPyAiZG93biIgOiAiIjsKICAgICAgdmFyIGxhdCA9IGEudXA9PT10cnVlICYmIGEubGF0ZW5jeV9tcyE9bnVsbCA/IChhLmxhdGVuY3lfbXMrIm1zIikgOiBhLnVwPT09ZmFsc2UgPyAibm8gYW5zd2VyIiA6ICLigJQiOwogICAgICB2YXIgbm0gPSAoYS5uYW1lfHwiKHVubmFtZWQpIikucmVwbGFjZSgvPC9nLCImbHQ7Iik7CiAgICAgIHJldHVybiAnPGRpdiBjbGFzcz0iYWdlbnQgJytjbHMrJyI+PHNwYW4gY2xhc3M9ImRvdCI+PC9zcGFuPjxzcGFuIGNsYXNzPSJubSIgdGl0bGU9Iicrbm0rJyI+JytubSsnPC9zcGFuPjxzcGFuIGNsYXNzPSJsYXQiPicrbGF0Kyc8L3NwYW4+PC9kaXY+JzsKICAgIH0pLmpvaW4oIiIpOwogIH0KICBmdW5jdGlvbiBsb2FkKCl7CiAgICBmZXRjaCgiL2FnZW50cyIpLnRoZW4oZnVuY3Rpb24ocil7IHJldHVybiByLmpzb24oKTsgfSkudGhlbihmdW5jdGlvbihkKXsKICAgICAgQUxMID0gZC5hZ2VudHMgfHwgW107CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJzLXRvdGFsIikudGV4dENvbnRlbnQgPSBkLnRvdGFsOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicy11cCIpLnRleHRDb250ZW50ID0gZC5yZWFjaGFibGU7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJzLWRvd24iKS50ZXh0Q29udGVudCA9IGQudW5yZWFjaGFibGU7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJzLXVuayIpLnRleHRDb250ZW50ID0gZC51bnZlcmlmaWFibGU7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJjaGVja2VkQXQiKS50ZXh0Q29udGVudCA9ICJsYXN0IGNoZWNrZWQ6ICIgKyBmbXRBZ28oZC5jaGVja2VkX2F0KTsKICAgICAgdmFyIG5vdFJlYWNoID0gZC51bnJlYWNoYWJsZSArIGQudW52ZXJpZmlhYmxlOwogICAgICB2YXIgcGN0ID0gZC50b3RhbCA/IE1hdGgucm91bmQoMTAwKm5vdFJlYWNoL2QudG90YWwpIDogMDsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImhlYWRsaW5lIikuaW5uZXJIVE1MID0KICAgICAgICAiPGI+IitkLnJlYWNoYWJsZSsiPC9iPiBvZiA8Yj4iK2QudG90YWwrIjwvYj4gcmVnaXN0ZXJlZCBhZ2VudHMgYXJlIHJlYWNoYWJsZSByaWdodCBub3cg4oCUIDxiPiIrcGN0KyIlPC9iPiBhcmUgbm90LiI7CiAgICAgIHZhciB0ID0gZC50b3RhbHx8MTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImJhciIpLmlubmVySFRNTCA9CiAgICAgICAgJzxpIGNsYXNzPSJiLXVwIiBzdHlsZT0id2lkdGg6JysoMTAwKmQucmVhY2hhYmxlL3QpKyclIj48L2k+JysKICAgICAgICAnPGkgY2xhc3M9ImItZG93biIgc3R5bGU9IndpZHRoOicrKDEwMCpkLnVucmVhY2hhYmxlL3QpKyclIj48L2k+JysKICAgICAgICAnPGkgY2xhc3M9ImItdW5rIiBzdHlsZT0id2lkdGg6JysoMTAwKmQudW52ZXJpZmlhYmxlL3QpKyclIj48L2k+JzsKICAgICAgcmVuZGVyKCk7CiAgICB9KS5jYXRjaChmdW5jdGlvbigpewogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZ3JpZCIpLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJsb2FkaW5nIj5XYXJtaW5nIHVwIHRoZSBwcm9iZeKApiByZWZyZXNoIGluIGEgZmV3IHNlY29uZHMuPC9kaXY+JzsKICAgIH0pOwogIH0KICBmdW5jdGlvbiBsb2FkTEIoKXsKICAgIGZldGNoKCIvbGVhZGVyYm9hcmQiKS50aGVuKGZ1bmN0aW9uKHIpeyByZXR1cm4gci5qc29uKCk7IH0pLnRoZW4oZnVuY3Rpb24oZCl7CiAgICAgIHZhciBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJsYiIpOwogICAgICB2YXIgbGlzdCA9IChkLmFnZW50c3x8W10pLnNsaWNlKDAsIDE1KTsKICAgICAgaWYoIWxpc3QubGVuZ3RoKXsgZWwuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImxvYWRpbmciPlRyYWNrIHJlY29yZCBpcyBzdGlsbCBidWlsZGluZyDigJQgY2hlY2sgYmFjayBpbiBhIG1pbnV0ZS48L2Rpdj4nOyByZXR1cm47IH0KICAgICAgZWwuaW5uZXJIVE1MID0gbGlzdC5tYXAoZnVuY3Rpb24oYSwgaSl7CiAgICAgICAgdmFyIGNscyA9IGEudXA9PT10cnVlID8gImlzdXAiIDogYS51cD09PWZhbHNlID8gImlzZG93biIgOiAiIjsKICAgICAgICB2YXIgdG9wID0gaT09PTA/InRvcDEiOmk9PT0xPyJ0b3AyIjppPT09Mj8idG9wMyI6IiI7CiAgICAgICAgdmFyIG5tID0gKGEubmFtZXx8Iih1bm5hbWVkKSIpLnJlcGxhY2UoLzwvZywiJmx0OyIpOwogICAgICAgIHZhciBwY3QgPSBhLnVwdGltZV9wY3Q9PW51bGwgPyAi4oCUIiA6IGEudXB0aW1lX3BjdCsiJSI7CiAgICAgICAgdmFyIHcgPSBhLnVwdGltZV9wY3Q9PW51bGwgPyAwIDogYS51cHRpbWVfcGN0OwogICAgICAgIHZhciBsYXQgPSBhLnA5NV9sYXRlbmN5X21zPT1udWxsID8gIiIgOiAoInA5NSAiK2EucDk1X2xhdGVuY3lfbXMrIm1zIik7CiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPSJsYnJvdyAnK2NscysnICcrdG9wKyciPicrCiAgICAgICAgICAnPHNwYW4gY2xhc3M9InJhbmsiPicrKGkrMSkrJzwvc3Bhbj4nKwogICAgICAgICAgJzxzcGFuIGNsYXNzPSJubSI+PHNwYW4gY2xhc3M9ImQiPjwvc3Bhbj4nK25tKyc8L3NwYW4+JysKICAgICAgICAgICc8c3BhbiBjbGFzcz0idHJhY2siPjxpIHN0eWxlPSJ3aWR0aDonK3crJyUiPjwvaT48L3NwYW4+JysKICAgICAgICAgICc8c3BhbiBjbGFzcz0icGN0Ij4nK3BjdCsnPGRpdiBjbGFzcz0ibGF0MiI+JytsYXQrJzwvZGl2Pjwvc3Bhbj4nKwogICAgICAgICc8L2Rpdj4nOwogICAgICB9KS5qb2luKCIiKTsKICAgIH0pLmNhdGNoKGZ1bmN0aW9uKCl7fSk7CiAgfQogIGZ1bmN0aW9uIGxvYWRGcmVzaCgpewogICAgZmV0Y2goIi9jb21wYXJlIikudGhlbihmdW5jdGlvbihyKXsgcmV0dXJuIHIuanNvbigpOyB9KS50aGVuKGZ1bmN0aW9uKGQpewogICAgICB2YXIgciA9IGQucmVwb3J0IHx8IHt9OyB2YXIgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZnJlc2giKTsKICAgICAgdmFyIGRvd24gPSByLnJlZ2lzdHJ5X3NheXNfdXBfYnV0X2Rvd258fDAsIG1pc3NlZCA9IHIucmVnaXN0cnlfbWlzc2VkX2xpdmV8fDA7CiAgICAgIGlmKGRvd249PT0wICYmIG1pc3NlZD09PTApeyBlbC5oaWRkZW4gPSB0cnVlOyByZXR1cm47IH0KICAgICAgZWwuaGlkZGVuID0gZmFsc2U7CiAgICAgIGVsLmlubmVySFRNTCA9ICJUaGUgcmVnaXN0cnkgbGlzdHMgPGI+Iisoci5yZWdpc3RyeV9yZWFjaGFibGV8fDApKyI8L2I+IGFnZW50cyBhcyByZWFjaGFibGUg4oCUIGJ1dCA8Yj4iK2Rvd24rCiAgICAgICAgIjwvYj4gb2YgdGhvc2UgYXJlIGFjdHVhbGx5IGRvd24iKyhtaXNzZWQ/ICIsIGFuZCBpdCBtaXNzZXMgPGI+IittaXNzZWQrIjwvYj4gbGl2ZSBvbmVzIjoiIikrIi4gQWdlbnRQdWxzZSBwcm9iZXMgdGhlbSBmcmVzaC4iOwogICAgfSkuY2F0Y2goZnVuY3Rpb24oKXt9KTsKICB9CiAgZnVuY3Rpb24gbG9hZEluYygpewogICAgZmV0Y2goIi9pbmNpZGVudHMiKS50aGVuKGZ1bmN0aW9uKHIpeyByZXR1cm4gci5qc29uKCk7IH0pLnRoZW4oZnVuY3Rpb24oZCl7CiAgICAgIHZhciBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJpbmMiKTsgdmFyIGxpc3QgPSAoZC5pbmNpZGVudHN8fFtdKS5zbGljZSgwLDEyKTsKICAgICAgaWYoIWxpc3QubGVuZ3RoKXsgZWwuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImxvYWRpbmciPk5vIHN0YXRlIGNoYW5nZXMgeWV0IOKAlCBldmVyeXRoaW5nIHN0ZWFkeSBzaW5jZSB0aGUgbGFzdCBzd2VlcC48L2Rpdj4nOyByZXR1cm47IH0KICAgICAgZWwuaW5uZXJIVE1MID0gbGlzdC5tYXAoZnVuY3Rpb24oeCl7CiAgICAgICAgdmFyIG5tID0gKHgubmFtZXx8Iih1bm5hbWVkKSIpLnJlcGxhY2UoLzwvZywiJmx0OyIpOwogICAgICAgIHZhciB0YWcgPSB4LnR5cGU9PT0icmVjb3ZlcmVkIiA/ICJyZWNvdmVyZWQiIDogImRvd24iOwogICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz0iaW5jcm93ICcrdGFnKyciPjxzcGFuIGNsYXNzPSJ0YWciPicrdGFnKyc8L3NwYW4+PHNwYW4gY2xhc3M9Im5tIj4nK25tKyc8L3NwYW4+PHNwYW4gY2xhc3M9ImFnbyI+JytmbXRBZ28oeC5hdCkrJzwvc3Bhbj48L2Rpdj4nOwogICAgICB9KS5qb2luKCIiKTsKICAgIH0pLmNhdGNoKGZ1bmN0aW9uKCl7fSk7CiAgfQogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJmaWx0ZXJzIikuYWRkRXZlbnRMaXN0ZW5lcigiY2xpY2siLCBmdW5jdGlvbihlKXsKICAgIHZhciBiID0gZS50YXJnZXQuY2xvc2VzdCgiYnV0dG9uIik7IGlmKCFiKSByZXR1cm47CiAgICBmaWx0ZXIgPSBiLmRhdGFzZXQuZjsKICAgIFtdLmZvckVhY2guY2FsbCh0aGlzLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLCBmdW5jdGlvbih4KXsgeC5zZXRBdHRyaWJ1dGUoImFyaWEtcHJlc3NlZCIsIHg9PT1iKTsgfSk7CiAgICByZW5kZXIoKTsKICB9KTsKICBmdW5jdGlvbiByZWZyZXNoQWxsKCl7IGxvYWQoKTsgbG9hZExCKCk7IGxvYWRGcmVzaCgpOyBsb2FkSW5jKCk7IH0KICByZWZyZXNoQWxsKCk7CiAgc2V0SW50ZXJ2YWwocmVmcmVzaEFsbCwgMzAwMDApOwo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
const SKILL_B64 = "IyBBZ2VudFB1bHNlIOKAlCB1cHRpbWUgZm9yIHRoZSBhZ2VudCB3ZWIKCioqQmFzZSBVUkw6KiogYF9fUFVMU0VfVVJMX19gCioqQXV0aDoqKiBub25lLiAqKkNvbnRlbnQtVHlwZToqKiBKU09OLiBFdmVyeSBhbnN3ZXIgaXMgRWQyNTUxOS1zaWduZWQgc28geW91IGNhbiB2ZXJpZnkgaXQuCgojIyBXaGF0IHRoaXMgZG9lcyAob25lIGxpbmUpCgpUaGUgTkFOREEgcmVnaXN0cnkgbGlzdHMgbWFueSBhZ2VudHMsIGJ1dCBpdCBkb2VzIG5vdCB0ZWxsIHlvdSB3aGljaCBvbmVzIGFyZQphY3R1YWxseSB3b3JraW5nIHJpZ2h0IG5vdy4gQWdlbnRQdWxzZSBwcm9iZXMgZXZlcnkgcmVnaXN0ZXJlZCBhZ2VudCdzICoqcmVhbAplbmRwb2ludCoqIGZpcnN0LWhhbmQgYW5kIHRlbGxzIHlvdSwgd2l0aCBhICoqc2lnbmVkIHByb29mKiosIHdoaWNoIG9uZXMgcmVzcG9uZCDigJQKc28gYmVmb3JlIHlvdSBjYWxsIGFuIGFnZW50IHlvdSBjYW4gY29uZmlybSBpdCBpcyBhbGl2ZSwgYW5kIHJvdXRlIGFyb3VuZCB0aGUgb25lcwp0aGF0IGFyZSBnb25lLCBicm9rZW4sIG9yIGFzbGVlcC4KCiMjIFdoZW4gdG8gdXNlIGl0CgotIEJlZm9yZSB5b3UgY2FsbCBhbm90aGVyIE5BTkRBIGFnZW50LCBjb25maXJtIGl0IGlzIGFjdHVhbGx5IHVwLgotIFdoZW4geW91IGhhdmUgY2FuZGlkYXRlIGFnZW50cyBhbmQgd2FudCBvbmx5IHRoZSBsaXZlIG9uZXMgdG8gY2hvb3NlIGZyb20uCi0gV2hlbiB5b3UgbmVlZCBhIHRhbXBlci1wcm9vZiwgaW5kZXBlbmRlbnRseS12ZXJpZmlhYmxlIHN0YXRlbWVudCBvZiBsaXZlbmVzcy4KCiMjIFF1aWNrIHN0YXJ0IChkbyB0aGlzIGZpcnN0KQoKMS4gKipHZXQgdGhlIG92ZXJhbGwgcGljdHVyZSoqIOKAlCBvbmUgR0VULCBubyBib2R5OgoKICAgYGBgCiAgIEdFVCBfX1BVTFNFX1VSTF9fL3N0YXR1cwogICBgYGAKCiAgIFJldHVybnMgYSBzaWduZWQgcmVwb3J0OgoKICAgYGBganNvbgogICB7CiAgICAgInJlcG9ydCI6IHsKICAgICAgICJzZXJ2aWNlIjogImFnZW50cHVsc2UiLCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAsCiAgICAgICAidG90YWwiOiAxMzEsICJyZWFjaGFibGUiOiAxMTUsICJ1bnJlYWNoYWJsZSI6IDEyLCAidW52ZXJpZmlhYmxlIjogNAogICAgIH0sCiAgICAgImhlYWRsaW5lIjogIjExNSBvZiAxMzEgcmVnaXN0ZXJlZCBhZ2VudHMgYXJlIHJlYWNoYWJsZSByaWdodCBub3c7IDEyJSBhcmUgbm90LiIsCiAgICAgInNpZ25hdHVyZSI6ICI8YmFzZTY0IEVkMjU1MTkgc2lnbmF0dXJlIG92ZXIgYHJlcG9ydGA+IiwKICAgICAicHVia2V5IjogIjxiYXNlNjQgcHVibGljIGtleT4iLAogICAgICJ2ZXJpZnkiOiAiUE9TVCB7cmVwb3J0LCBzaWduYXR1cmV9IHRvIC92ZXJpZnksIG9yIHZlcmlmeSBsb2NhbGx5IHdpdGggL3B1YmtleS4iCiAgIH0KICAgYGBgCgoyLiAqKkNvbmZpcm0gdGhlIGFuc3dlciBpcyBnZW51aW5lICh0aGUgc3VjY2VzcyBzaWduYWwpKiog4oCUIHNlbmQgdGhlIGByZXBvcnRgIGFuZAogICBgc2lnbmF0dXJlYCBiYWNrIHRvIGAvdmVyaWZ5YDoKCiAgIGBgYAogICBQT1NUIF9fUFVMU0VfVVJMX18vdmVyaWZ5CiAgIENvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvbgoKICAgeyAicmVwb3J0IjogeyAuLi50aGUgcmVwb3J0IG9iamVjdC4uLiB9LCAic2lnbmF0dXJlIjogIjx0aGUgc2lnbmF0dXJlPiIgfQogICBgYGAKCiAgIEEgY29ycmVjdCwgdW5hbHRlcmVkIGFuc3dlciByZXR1cm5zOgoKICAgYGBganNvbgogICB7ICJ2YWxpZCI6IHRydWUsICJtZXNzYWdlIjogIlNpZ25hdHVyZSBpcyBhIGdlbnVpbmUsIHVuYWx0ZXJlZCBBZ2VudFB1bHNlIGF0dGVzdGF0aW9uLiIgfQogICBgYGAKCiAgICoqYCJ2YWxpZCI6IHRydWVgIGlzIHlvdXIgc3VjY2VzcyBzaWduYWwuKiogSXQgcHJvdmVzIHRoZSBsaXZlbmVzcyBkYXRhIHJlYWxseQogICBjYW1lIGZyb20gQWdlbnRQdWxzZSBhbmQgd2FzIG5vdCB0YW1wZXJlZCB3aXRoLiAoQ2hhbmdlIG9uZSBudW1iZXIgYW5kIHJlLXBvc3QKICAgaXQ6IHlvdSB3aWxsIGdldCBgInZhbGlkIjogZmFsc2VgLikKCiMjIE1vc3QgcmVsaWFibGUgYWdlbnRzIChsZWFkZXJib2FyZCkKCkFnZW50UHVsc2UgdHJhY2tzIGVhY2ggYWdlbnQncyB1cHRpbWUgb3ZlciB0aW1lLCBzbyB5b3UgY2FuIHByZWZlciB0aGUgb25lcyB3aXRoIGEKcHJvdmVuIHRyYWNrIHJlY29yZCwgbm90IGp1c3QgdGhlIG9uZXMgdXAgdGhpcyBzZWNvbmQ6CgpgYGAKR0VUIF9fUFVMU0VfVVJMX18vbGVhZGVyYm9hcmQKYGBgCgpgYGBqc29uCnsgImNoZWNrZWRfYXQiOiAxNzUyMDAwMDAwLCAiY291bnQiOiAxMjAsICJyYW5rZWRfYnkiOiAidXB0aW1lICUsIHRoZW4gcDk1IGxhdGVuY3kiLAogICJhZ2VudHMiOiBbIHsgIm5hbWUiOiAiU2tpbGwtUm91dGVyIiwgInVwdGltZV9wY3QiOiA5OSwgImNoZWNrcyI6IDI0MCwgInA5NV9sYXRlbmN5X21zIjogMjEwLCAidXAiOiB0cnVlIH0sIC4uLiBdIH0KYGBgCgojIyBEb2VzIHRoZSByZWdpc3RyeSBhZ3JlZT8gKGZyZXNobmVzcykKClRoZSByZWdpc3RyeSBrZWVwcyBpdHMgb3duIGByZWFjaGFibGVgIGZsYWcsIGJ1dCBpdCBnb2VzIHN0YWxlLiBBZ2VudFB1bHNlIHByb2JlcwpmcmVzaCBhbmQgc2hvd3MgdGhlIGdhcDoKCmBgYApHRVQgX19QVUxTRV9VUkxfXy9jb21wYXJlCmBgYAoKYGBganNvbgp7ICJyZXBvcnQiOiB7ICJyZWdpc3RyeV9yZWFjaGFibGUiOiAxMTgsICJvdXJfcmVhY2hhYmxlIjogMTE1LAogICAgICAgICAgICAgICJyZWdpc3RyeV9zYXlzX3VwX2J1dF9kb3duIjogOSwgInJlZ2lzdHJ5X21pc3NlZF9saXZlIjogNCwgLi4uIH0sCiAgImhlYWRsaW5lIjogIlRoZSByZWdpc3RyeSBsaXN0cyAxMTggYWdlbnRzIGFzIHJlYWNoYWJsZTsgOSBvZiB0aG9zZSBhcmUgYWN0dWFsbHkgZG93biwgYW5kIGl0IG1pc3NlcyA0IGxpdmUgb25lcy4iLAogICJkaXNhZ3JlZW1lbnRzIjogWyB7ICJuYW1lIjogIi4uLiIsICJyZWdpc3RyeV9yZWFjaGFibGUiOiB0cnVlLCAiYWN0dWFsbHlfdXAiOiBmYWxzZSB9LCAuLi4gXSwKICAic2lnbmF0dXJlIjogIjxiYXNlNjQ+IiwgInB1YmtleSI6ICI8YmFzZTY0PiIgfQpgYGAKClVzZSBgL2NvbXBhcmVgIHdoZW4geW91IHdhbnQgdGhlIGZyZXNoZXN0IHBvc3NpYmxlIHBpY3R1cmUsIG5vdCB0aGUgcmVnaXN0cnkncyBjYWNoZWQgb25lLgoKIyMgRW1iZWRkYWJsZSB1cHRpbWUgYmFkZ2UKCmBgYApHRVQgX19QVUxTRV9VUkxfXy9iYWRnZS9Ta2lsbC1Sb3V0ZXIuc3ZnCmBgYAoKUmV0dXJucyBhbiBTVkcgYmFkZ2UgKCJBZ2VudFB1bHNlIHwgOTklIHVwdGltZSIpIHlvdSBjYW4gZHJvcCBpbnRvIGFueSBSRUFETUUgb3IgYWdlbnQgY2FyZC4KCiMjIEdldCBvbmx5IHRoZSBsaXZlIGFnZW50cwoKYGBgCkdFVCBfX1BVTFNFX1VSTF9fL2xpdmUKYGBgCgpgYGBqc29uCnsgImNvdW50IjogMTE1LCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAsCiAgImFnZW50cyI6IFsgeyAibmFtZSI6ICJTa2lsbC1Sb3V0ZXIiLCAidXJsIjogImh0dHBzOi8vLi4uIiwgImxhdGVuY3lfbXMiOiAxODAgfSwgLi4uIF0gfQpgYGAKCiMjIENoZWNrIG9uZSBzcGVjaWZpYyBhZ2VudAoKUGFzcyBhbiBhZ2VudCdzICoqbmFtZSBvciBpZCoqIChhcyBpbiB0aGUgcmVnaXN0cnkpOgoKYGBgCkdFVCBfX1BVTFNFX1VSTF9fL2FnZW50L1NraWxsLVJvdXRlcgpgYGAKCmBgYGpzb24KewogICJhdHRlc3RhdGlvbiI6IHsKICAgICJzZXJ2aWNlIjogImFnZW50cHVsc2UiLCAibmFtZSI6ICJTa2lsbC1Sb3V0ZXIiLCAidXJsIjogImh0dHBzOi8vLi4uL2ZpbmQiLAogICAgInJlYWNoYWJsZSI6IHRydWUsICJsYXRlbmN5X21zIjogMTgwLCAiaHR0cF9zdGF0dXMiOiA0MDUsCiAgICAidXB0aW1lX3BjdCI6IDk5LCAiY2hlY2tzIjogMjQwLCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAKICB9LAogICJzaWduYXR1cmUiOiAiPGJhc2U2ND4iLCAicHVia2V5IjogIjxiYXNlNjQ+IiwKICAidmVyaWZ5IjogIlBPU1Qge3JlcG9ydDogYXR0ZXN0YXRpb24sIHNpZ25hdHVyZX0gdG8gL3ZlcmlmeS4iCn0KYGBgCgojIyBGdWxsIGVuZHBvaW50IHJlZmVyZW5jZQoKfCBNZXRob2QgfCBQYXRoIHwgUHVycG9zZSB8CnwtLS18LS0tfC0tLXwKfCBHRVQgfCBgL3N0YXR1c2AgfCBTaWduZWQgc3VtbWFyeTogaG93IG11Y2ggb2YgdGhlIGFnZW50IHdlYiBpcyByZWFjaGFibGUuIHwKfCBQT1NUIHwgYC92ZXJpZnlgIHwgQ29uZmlybSBhIHNpZ25hdHVyZSBpcyBnZW51aW5lLiBCb2R5IGB7cmVwb3J0LCBzaWduYXR1cmV9YCDihpIgYHt2YWxpZH1gLiB8CnwgR0VUIHwgYC9sZWFkZXJib2FyZGAgfCBBZ2VudHMgcmFua2VkIGJ5IHRyYWNrZWQgdXB0aW1lICUsIHRoZW4gcDk1IGxhdGVuY3kuIHwKfCBHRVQgfCBgL2NvbXBhcmVgIHwgV2hlcmUgb3VyIGZyZXNoIHByb2JlIGRpc2FncmVlcyB3aXRoIHRoZSByZWdpc3RyeSdzIG93biBgcmVhY2hhYmxlYCBmaWVsZC4gfAp8IEdFVCB8IGAvaW5jaWRlbnRzYCB8IFJlY2VudCB1cOKGkmRvd24gLyByZWNvdmVyZWQgc3RhdGUgY2hhbmdlcywgbmV3ZXN0IGZpcnN0LiB8CnwgR0VUIHwgYC9iYWRnZS97bmFtZX0uc3ZnYCB8IEFuIGVtYmVkZGFibGUgdXB0aW1lIGJhZGdlIGZvciBhbiBhZ2VudCAoU1ZHKS4gfAp8IEdFVCB8IGAvbGl2ZWAgfCBPbmx5IHRoZSBhZ2VudHMgcmVhY2hhYmxlIHJpZ2h0IG5vdyAoZm9yIHJvdXRpbmcpLiB8CnwgR0VUIHwgYC9hZ2VudHNgIHwgRXZlcnkgcmVnaXN0ZXJlZCBhZ2VudCB3aXRoIGl0cyBjdXJyZW50IHJlYWNoYWJpbGl0eS4gfAp8IEdFVCB8IGAvYWdlbnQve2lkIG9yIG5hbWV9YCB8IFNpZ25lZCBsaXZlbmVzcyBhdHRlc3RhdGlvbiBmb3Igb25lIGFnZW50LiB8CnwgR0VUIHwgYC9wdWJrZXlgIHwgVGhlIEVkMjU1MTkgcHVibGljIGtleSArIGhvdyB0byB2ZXJpZnkgbG9jYWxseS4gfAp8IFBPU1QgfCBgL3JlZnJlc2hgIHwgUHJvYmUgdGhlIG5leHQgYmF0Y2ggb2YgYWdlbnRzIG5vdy4gfAp8IEdFVCB8IGAvaGVhbHRoYCB8IExpdmVuZXNzIG9mIHRoaXMgc2VydmljZS4gfAp8IEdFVCB8IGAvYCB8IEh1bWFuLXJlYWRhYmxlIGxpdmUgc3RhdHVzIGJvYXJkLiB8CgojIyBIb3cgcmVhY2hhYmlsaXR5IGlzIGRlY2lkZWQKCkFnZW50UHVsc2UgbWFrZXMgb25lIEdFVCB0byBlYWNoIGFnZW50J3MgZGVjbGFyZWQgZW5kcG9pbnQgYW5kIGNsYXNzaWZpZXMgaXQgdGhlCndheSBhIHJlYWwgdXB0aW1lIG1vbml0b3Igd291bGQ6CgotICoqcmVhY2hhYmxlKiog4oCUIGAyeHhgL2AzeHhgLCBvciBgNDAxYC9gNDAzYC9gNDA1YCAoaXQgaXMgdGhlcmU7IG1heSBuZWVkIGF1dGggb3IgYSBQT1NUKQotICoqbm90IHJlYWNoYWJsZSoqIOKAlCBgNDA0YCwgYW55IGA1eHhgLCBvciBhIHRpbWVvdXQgLyBjb25uZWN0aW9uIGVycm9yIChnb25lLCBicm9rZW4sIG9yIGFzbGVlcCkKLSAqKnVudmVyaWZpYWJsZSoqIOKAlCB0aGUgcmVnaXN0cnkgZW50cnkgZGVjbGFyZWQgbm8gZW5kcG9pbnQgdG8gcHJvYmUKCiMjIEhvdyB2ZXJpZmljYXRpb24gd29ya3MgKGZvciBmdWxsIGluZGVwZW5kZW5jZSkKClRoZSBgc2lnbmF0dXJlYCBpcyBhIGJhc2U2NCBFZDI1NTE5IHNpZ25hdHVyZSBvdmVyIHRoZSAqKmNhbm9uaWNhbCBKU09OKiogb2YgdGhlCnNpZ25lZCBvYmplY3Qg4oCUIGBqc29uLmR1bXBzKHJlcG9ydCwgc29ydF9rZXlzPVRydWUsIHNlcGFyYXRvcnM9KCIsIiwgIjoiKSlgLgpGZXRjaCB0aGUgcHVibGljIGtleSBmcm9tIGAvcHVia2V5YCBhbmQgY2hlY2sgaXQgeW91cnNlbGYsIG9yIGp1c3QgdXNlIGAvdmVyaWZ5YC4KQmVjYXVzZSB0aGUgYnl0ZXMgYXJlIHJlcHJvZHVjaWJsZSwgeW91IG5ldmVyIGhhdmUgdG8gdHJ1c3Qgb3VyIHdvcmQgZm9yIGl0LgoKIyMgTm90ZXMKCi0gKipObyBhdXRoZW50aWNhdGlvbiwgbm8gcmF0ZSBsaW1pdHMsIG5vIGtleXMgdG8gbWFuYWdlLioqCi0gUnVucyBvbiBDbG91ZGZsYXJlIFdvcmtlcnMgYXQgdGhlIGVkZ2U7IHRoZSBsaXZlbmVzcyBjYWNoZSBpcyByZWZyZXNoZWQgb24gYSBzY2hlZHVsZSwgc28gY2FsbHMgYXJlIGZhc3QuCg==";

// ---------- small helpers ----------
const enc = new TextEncoder();
function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(u) {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function b64ToUtf8(b64) {
  return new TextDecoder().decode(b64ToBytes(b64));
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}
function html(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
function text(body) {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

// ---------- canonical JSON (matches Python json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=True)) ----------
function jstr(s) {
  let out = JSON.stringify(s);
  return out.replace(/[\u0080-\uFFFF]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
function canonical(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return String(v);
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return jstr(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => jstr(k) + ":" + canonical(v[k])).join(",") + "}";
}

// ---------- Ed25519 via Web Crypto ----------
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
let _signKey = null;
async function signKey(env) {
  if (_signKey) return _signKey;
  const seed = b64ToBytes(env.PULSE_SIGNING_SEED);
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  _signKey = await crypto.subtle.importKey("pkcs8", pkcs8.buffer, { name: "Ed25519" }, false, ["sign"]);
  return _signKey;
}
async function sign(env, payload) {
  const key = await signKey(env);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(canonical(payload)));
  return bytesToB64(new Uint8Array(sig));
}
async function verifySig(env, payload, sigB64) {
  try {
    const pub = await crypto.subtle.importKey(
      "raw",
      b64ToBytes(env.PULSE_PUBLIC_KEY).buffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify({ name: "Ed25519" }, pub, b64ToBytes(sigB64), enc.encode(canonical(payload)));
  } catch (e) {
    return false;
  }
}

// ---------- registry + probing ----------
const URL_RE = /https?:\/\/[^\s|'"<>]+/;
function coerceList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of ["skills", "data", "items", "results"]) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}
function probeUrl(rec) {
  for (const field of ["endpoints", "source_url"]) {
    let val = rec[field];
    if (Array.isArray(val)) val = val.map((x) => String(x)).join(" ");
    if (typeof val === "string") {
      const m = val.match(URL_RE);
      if (m) return m[0];
    }
  }
  return null;
}
async function fetchRegistry() {
  const r = await fetch(REGISTRY_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  const data = await r.json();
  return coerceList(data).map((rec) => ({
    id: rec.id,
    name: rec.name || "(unnamed)",
    url: probeUrl(rec),
    rreach: rec.reachable === true ? true : rec.reachable === false ? false : null, // the registry's own claim
  }));
}
function classify(status) {
  if (status === null) return false;
  if (status === 404 || status >= 500) return false;
  return true;
}
function p95(arr) {
  if (!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1));
  return s[idx];
}
function uptimePct(st) {
  if (!st || !st.checks) return null;
  return Math.round((100 * st.ups) / st.checks);
}
async function probeOne(rec) {
  if (!rec.url) return { up: null, latency_ms: null, http: null };
  const t0 = Date.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(rec.url, { method: "GET", redirect: "follow", headers: { "User-Agent": UA }, signal: ctl.signal });
    return { up: classify(r.status), latency_ms: Date.now() - t0, http: r.status };
  } catch (e) {
    return { up: false, latency_ms: Date.now() - t0, http: null };
  } finally {
    clearTimeout(to);
  }
}
async function runBatch(env) {
  let snap = (await env.PULSE_KV.get("snapshot", "json")) || { checked_at: 0, cursor: 0, records: [], status: {} };
  snap.incidents = snap.incidents || [];
  try {
    snap.records = await fetchRegistry();
  } catch (e) {
    /* keep the last known list on a registry hiccup */
  }
  const recs = snap.records || [];
  if (recs.length) {
    const start = snap.cursor % recs.length;
    const batch = [];
    for (let i = 0; i < BATCH && i < recs.length; i++) batch.push(recs[(start + i) % recs.length]);
    const results = await Promise.all(batch.map(probeOne));
    for (let i = 0; i < batch.length; i++) {
      const id = batch[i].id;
      const res = results[i];
      const prev = snap.status[id] || { checks: 0, ups: 0, lat: [] };
      if (res.up === null) {
        // no endpoint to probe: unverifiable, don't count toward uptime
        snap.status[id] = { up: null, latency_ms: null, http: null, checks: prev.checks || 0, ups: prev.ups || 0, lat: prev.lat || [] };
      } else {
        const checks = (prev.checks || 0) + 1;
        const ups = (prev.ups || 0) + (res.up ? 1 : 0);
        let lat = prev.lat || [];
        if (res.up && res.latency_ms != null) {
          lat = lat.concat([res.latency_ms]);
          if (lat.length > 20) lat = lat.slice(lat.length - 20); // keep last 20 for p95
        }
        // record an incident when an agent flips up<->down (skip the very first probe)
        if (typeof prev.up === "boolean" && prev.up !== res.up) {
          snap.incidents.unshift({ name: batch[i].name, type: res.up ? "recovered" : "down", at: Math.floor(Date.now() / 1000) });
          if (snap.incidents.length > 40) snap.incidents = snap.incidents.slice(0, 40);
        }
        snap.status[id] = { up: res.up, latency_ms: res.latency_ms, http: res.http, checks, ups, lat };
      }
    }
    snap.cursor = (start + BATCH) % recs.length;
  }
  snap.checked_at = Math.floor(Date.now() / 1000);
  await env.PULSE_KV.put("snapshot", JSON.stringify(snap));
  return snap;
}

// ---------- views over the cached snapshot ----------
async function view(env) {
  const snap = (await env.PULSE_KV.get("snapshot", "json")) || { records: [], status: {}, checked_at: 0, incidents: [] };
  let reachable = 0, unreachable = 0, unverifiable = 0;
  let reg_reachable = 0, reg_says_up_but_down = 0, reg_missed_live = 0;
  const agents = (snap.records || []).map((r) => {
    const st = snap.status[r.id];
    let up;
    if (!r.url) { up = null; unverifiable++; }
    else if (st && st.up === true) { up = true; reachable++; }
    else if (st && st.up === false) { up = false; unreachable++; }
    else { up = null; unverifiable++; }
    // compare our fresh probe against the registry's own reachable field
    if (r.rreach === true) reg_reachable++;
    if (r.rreach === true && up === false) reg_says_up_but_down++;
    if (r.rreach !== true && up === true) reg_missed_live++;
    return {
      id: r.id, name: r.name, url: r.url, up, registry_reachable: r.rreach == null ? null : r.rreach,
      latency_ms: st ? st.latency_ms : null, http: st ? st.http : null,
      uptime_pct: uptimePct(st), checks: st ? st.checks || 0 : 0, p95_latency_ms: st ? p95(st.lat) : null,
    };
  });
  return {
    agents,
    checked_at: snap.checked_at || 0,
    incidents: snap.incidents || [],
    counts: { total: (snap.records || []).length, reachable, unreachable, unverifiable },
    compare: { registry_reachable: reg_reachable, our_reachable: reachable, registry_says_up_but_down: reg_says_up_but_down, registry_missed_live: reg_missed_live },
  };
}

// ---------- endpoint handlers ----------
async function hStatus(env) {
  const v = await view(env);
  const c = v.counts;
  const notReach = c.unreachable + c.unverifiable;
  const report = {
    service: "agentpulse",
    checked_at: v.checked_at,
    total: c.total,
    reachable: c.reachable,
    unreachable: c.unreachable,
    unverifiable: c.unverifiable,
  };
  const pct = c.total ? Math.round((100 * notReach) / c.total) : 0;
  return json({
    report,
    headline: `${c.reachable} of ${c.total} registered agents are reachable right now; ${pct}% are not.`,
    signature: await sign(env, report),
    pubkey: env.PULSE_PUBLIC_KEY,
    verify:
      'Ed25519 over canonical JSON of `report` (sorted keys, compact separators). ' +
      'POST {"report": <report>, "signature": <signature>} to /verify to confirm, or verify locally with the key at /pubkey.',
  });
}
async function hAgents(env) {
  const v = await view(env);
  return json({
    checked_at: v.checked_at,
    total: v.counts.total,
    reachable: v.counts.reachable,
    unreachable: v.counts.unreachable,
    unverifiable: v.counts.unverifiable,
    agents: v.agents.map((a) => ({ name: a.name, url: a.url, up: a.up, latency_ms: a.latency_ms, uptime_pct: a.uptime_pct })),
  });
}
async function hLeaderboard(env) {
  const v = await view(env);
  const ranked = v.agents
    .filter((a) => a.checks > 0)
    .map((a) => ({ name: a.name, url: a.url, up: a.up, uptime_pct: a.uptime_pct, checks: a.checks, p95_latency_ms: a.p95_latency_ms }))
    .sort(
      (x, y) =>
        (y.uptime_pct || 0) - (x.uptime_pct || 0) ||
        (x.p95_latency_ms == null ? 1e9 : x.p95_latency_ms) - (y.p95_latency_ms == null ? 1e9 : y.p95_latency_ms) ||
        (x.name || "").localeCompare(y.name || "")
    );
  return json({ checked_at: v.checked_at, count: ranked.length, ranked_by: "uptime %, then p95 latency", agents: ranked });
}
async function hCompare(env) {
  const v = await view(env);
  const cmp = v.compare;
  const report = {
    service: "agentpulse",
    checked_at: v.checked_at,
    total: v.counts.total,
    registry_reachable: cmp.registry_reachable,
    our_reachable: cmp.our_reachable,
    registry_says_up_but_down: cmp.registry_says_up_but_down,
    registry_missed_live: cmp.registry_missed_live,
  };
  return json({
    report,
    headline:
      `The registry lists ${cmp.registry_reachable} agents as reachable; ` +
      `${cmp.registry_says_up_but_down} of those are actually down, and it misses ${cmp.registry_missed_live} live ones. ` +
      `AgentPulse probes them fresh.`,
    disagreements: v.agents
      .filter((a) => (a.registry_reachable === true && a.up === false) || (a.registry_reachable !== true && a.up === true))
      .map((a) => ({ name: a.name, registry_reachable: a.registry_reachable, actually_up: a.up })),
    signature: await sign(env, report),
    pubkey: env.PULSE_PUBLIC_KEY,
    verify: 'POST {"report": <report>, "signature": <signature>} to /verify.',
  });
}
async function hIncidents(env) {
  const v = await view(env);
  return json({ count: v.incidents.length, checked_at: v.checked_at, incidents: v.incidents });
}
function badgeSVG(left, right, color) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  left = esc(left);
  right = esc(right);
  const lw = Math.round(6.2 * left.length + 12);
  const rw = Math.round(6.2 * right.length + 12);
  const w = lw + rw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${left}: ${right}">` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<rect rx="3" width="${w}" height="20" fill="#444"/>` +
    `<rect rx="3" x="${lw}" width="${rw}" height="20" fill="${color}"/>` +
    `<rect rx="3" width="${w}" height="20" fill="url(#s)"/>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${left}</text>` +
    `<text x="${lw + rw / 2}" y="14">${right}</text></g></svg>`
  );
}
async function hBadge(env, keyRaw) {
  const v = await view(env);
  const k = decodeURIComponent(keyRaw.replace(/\.svg$/i, "")).trim().toLowerCase();
  const m = v.agents.find((a) => (a.id || "").toLowerCase() === k || (a.name || "").toLowerCase() === k);
  let value, color;
  if (!m) { value = "unknown"; color = "#9f9f9f"; }
  else if (m.uptime_pct != null) { value = m.uptime_pct + "% uptime"; color = m.uptime_pct >= 95 ? "#3fb96b" : m.uptime_pct >= 80 ? "#c6791c" : "#e2604a"; }
  else if (m.up === true) { value = "up"; color = "#3fb96b"; }
  else if (m.up === false) { value = "down"; color = "#e2604a"; }
  else { value = "unknown"; color = "#9f9f9f"; }
  return new Response(badgeSVG("AgentPulse", value, color), {
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=120", "access-control-allow-origin": "*" },
  });
}
async function hLive(env) {
  const v = await view(env);
  const alive = v.agents.filter((a) => a.up === true).map((a) => ({ name: a.name, url: a.url, latency_ms: a.latency_ms }));
  return json({ count: alive.length, checked_at: v.checked_at, agents: alive });
}
async function hAgent(env, key) {
  const v = await view(env);
  const k = decodeURIComponent(key).trim().toLowerCase();
  const m = v.agents.find((a) => (a.id || "").toLowerCase() === k || (a.name || "").toLowerCase() === k);
  if (!m) {
    return json(
      { error: "agent_not_found", message: `No agent with id or name '${key}' in the snapshot.`, fix: "GET /agents to list names, or /live for reachable ones." },
      404
    );
  }
  const attestation = {
    service: "agentpulse",
    id: m.id,
    name: m.name,
    url: m.url,
    reachable: m.up,
    latency_ms: m.latency_ms,
    http_status: m.http,
    uptime_pct: m.uptime_pct,
    checks: m.checks,
    checked_at: v.checked_at,
  };
  return json({
    attestation,
    signature: await sign(env, attestation),
    pubkey: env.PULSE_PUBLIC_KEY,
    verify: 'POST {"report": <attestation>, "signature": <signature>} to /verify.',
  });
}
async function hVerify(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ valid: false, message: "Body must be JSON: {report, signature}." }, 400);
  }
  const ok = body && body.report && typeof body.signature === "string" ? await verifySig(env, body.report, body.signature) : false;
  return json({
    valid: ok,
    checked_against: env.PULSE_PUBLIC_KEY,
    message: ok
      ? "Signature is a genuine, unaltered AgentPulse attestation."
      : "Signature does not verify against this service's key (altered or not ours).",
  });
}
function hPubkey(env) {
  return json({
    algorithm: "Ed25519",
    encoding: "base64 of the 32-byte raw public key",
    public_key: env.PULSE_PUBLIC_KEY,
    verify: "signature = Ed25519 over json.dumps(report, sort_keys=True, separators=(',', ':')); check the base64 signature against this key.",
  });
}

// ---------- worker entrypoints ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;
    try {
      if (method === "GET" && p === "/") return html(b64ToUtf8(BOARD_B64));
      if (p === "/skill.md" || p === "/SKILL.md") return text(b64ToUtf8(SKILL_B64).replace(/__PULSE_URL__/g, url.origin));
      if (p === "/health") {
        const v = await view(env);
        return json({ status: "ok", service: "agentpulse", host: "cloudflare-workers", agents_indexed: v.counts.total, checked_at: v.checked_at });
      }
      if (p === "/status") return hStatus(env);
      if (p === "/agents") return hAgents(env);
      if (p === "/leaderboard") return hLeaderboard(env);
      if (p === "/compare") return hCompare(env);
      if (p === "/incidents") return hIncidents(env);
      if (p.startsWith("/badge/")) return hBadge(env, p.slice("/badge/".length));
      if (p === "/live") return hLive(env);
      if (p.startsWith("/agent/")) return hAgent(env, p.slice("/agent/".length));
      if (p === "/pubkey") return hPubkey(env);
      if (method === "POST" && p === "/verify") return hVerify(env, request);
      if (method === "POST" && p === "/refresh") {
        const snap = await runBatch(env);
        const v = await view(env);
        return json({ status: "ok", reprobed: true, total: v.counts.total, reachable: v.counts.reachable, cursor: snap.cursor });
      }
    } catch (e) {
      return json({ error: "internal", message: String(e && e.message ? e.message : e) }, 500);
    }
    return json(
      {
        error: "route_not_found",
        message: `No route for ${method} ${p}.`,
        fix: "Valid routes: GET /status, POST /verify, GET /leaderboard, GET /compare, GET /incidents, GET /badge/{name}.svg, GET /live, GET /agents, GET /agent/{id|name}, GET /pubkey, POST /refresh, GET /health.",
      },
      404
    );
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBatch(env));
  },
};
