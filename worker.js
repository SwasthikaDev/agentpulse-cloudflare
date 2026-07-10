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

const BOARD_B64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xIj4KPHRpdGxlPkFnZW50UHVsc2Ug4oCUIGlzIHRoZSBhZ2VudCB3ZWIgYWxpdmU/PC90aXRsZT4KPG1ldGEgbmFtZT0iZGVzY3JpcHRpb24iIGNvbnRlbnQ9IkxpdmUsIHNpZ25lZCB1cHRpbWUgZm9yIGV2ZXJ5IGFnZW50IGluIHRoZSBOQU5EQSByZWdpc3RyeS4gU2VlIHdoaWNoIGFnZW50cyBhY3R1YWxseSBhbnN3ZXIgcmlnaHQgbm93LiI+CjxsaW5rIHJlbD0iaWNvbiIgaHJlZj0iZGF0YTppbWFnZS9zdmcreG1sLCUzQ3N2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJyUzRSUzQ3RleHQgeT0nLjllbScgZm9udC1zaXplPSc5MCclM0UlRjAlOUYlOTIlOTMlM0MvdGV4dCUzRSUzQy9zdmclM0UiPgo8c3R5bGU+CiAgOnJvb3R7CiAgICAtLWJnOiMwZDExMTc7IC0tcGFuZWw6IzEzMWMyNjsgLS1wYW5lbC0yOiMwZjE3MjA7IC0tbGluZTojMjMzMjQwOwogICAgLS10ZXh0OiNlOGVlZjQ7IC0tbXV0ZWQ6IzkzYTZiNDsgLS1mYWludDojNWY3MjgwOwogICAgLS11cDojM2ZiOTZiOyAtLWRvd246I2UyNjA0YTsgLS11bms6IzdjOGE5NzsgLS1hY2NlbnQ6I2U3YTMzZjsKICAgIC0tbW9ubzp1aS1tb25vc3BhY2UsIkNhc2NhZGlhIENvZGUiLCJTRiBNb25vIiwiSmV0QnJhaW5zIE1vbm8iLE1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTsKICAgIC0tc2FuczpzeXN0ZW0tdWksLWFwcGxlLXN5c3RlbSwiU2Vnb2UgVUkiLFJvYm90bywiSGVsdmV0aWNhIE5ldWUiLEFyaWFsLHNhbnMtc2VyaWY7CiAgfQogICp7Ym94LXNpemluZzpib3JkZXItYm94fQogIGJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdGV4dCk7Zm9udC1mYW1pbHk6dmFyKC0tc2Fucyk7bGluZS1oZWlnaHQ6MS42OwogICAgYmFja2dyb3VuZC1pbWFnZTpyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDE1JSAtMTAlLCByZ2JhKDIzMSwxNjMsNjMsLjA4KSwgdHJhbnNwYXJlbnQgNDAlKSxyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDEwMCUgMCUsIHJnYmEoNjMsMTg1LDEwNywuMDcpLCB0cmFuc3BhcmVudCAzNSUpfQogIC53cmFwe21heC13aWR0aDoxMDgwcHg7bWFyZ2luOjAgYXV0bztwYWRkaW5nOjAgMjJweH0KICBoZWFkZXJ7cGFkZGluZzo1NnB4IDAgMjJweH0KICAuZXllYnJvd3tmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjcycmVtO2xldHRlci1zcGFjaW5nOi4yZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLWFjY2VudCl9CiAgaDF7Zm9udC1zaXplOmNsYW1wKDJyZW0sNS41dncsMy4zcmVtKTtmb250LXdlaWdodDo4NTA7bGV0dGVyLXNwYWNpbmc6LS4wM2VtO21hcmdpbjoxMnB4IDAgMTBweDtsaW5lLWhlaWdodDoxfQogIC5zdWJ7Y29sb3I6dmFyKC0tbXV0ZWQpO21heC13aWR0aDo2NDBweDtmb250LXNpemU6MS4wOHJlbX0KICAuaGVhZGxpbmV7bWFyZ2luOjI2cHggMCA2cHg7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOmNsYW1wKDFyZW0sMi40dncsMS4zNXJlbSk7Zm9udC13ZWlnaHQ6NjAwfQogIC5oZWFkbGluZSBie2NvbG9yOnZhcigtLWFjY2VudCl9CiAgLm1ldGF7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43OHJlbTtjb2xvcjp2YXIoLS1mYWludCk7ZGlzcGxheTpmbGV4O2dhcDoxNnB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcn0KICAuZG90cHVsc2V7d2lkdGg6OHB4O2hlaWdodDo4cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS11cCk7ZGlzcGxheTppbmxpbmUtYmxvY2s7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywuNik7YW5pbWF0aW9uOnB1bHNlIDIuNHMgaW5maW5pdGV9CiAgQGtleWZyYW1lcyBwdWxzZXswJXtib3gtc2hhZG93OjAgMCAwIDAgcmdiYSg2MywxODUsMTA3LC41KX03MCV7Ym94LXNoYWRvdzowIDAgMCA3cHggcmdiYSg2MywxODUsMTA3LDApfTEwMCV7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywwKX19CiAgQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOiByZWR1Y2Upey5kb3RwdWxzZXthbmltYXRpb246bm9uZX19CgogIC5zdGF0c3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTUwcHgsMWZyKSk7Z2FwOjE0cHg7bWFyZ2luOjI2cHggMCA4cHh9CiAgLmNhcmR7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxOHB4IDIwcHh9CiAgLmNhcmQgLm57Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC13ZWlnaHQ6ODAwO2ZvbnQtc2l6ZToyLjFyZW07bGV0dGVyLXNwYWNpbmc6LS4wMmVtO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc30KICAuY2FyZCAua3tjb2xvcjp2YXIoLS1tdXRlZCk7Zm9udC1zaXplOi44NXJlbTttYXJnaW4tdG9wOjJweH0KICAuY2FyZC51cCAubntjb2xvcjp2YXIoLS11cCl9IC5jYXJkLmRvd24gLm57Y29sb3I6dmFyKC0tZG93bil9IC5jYXJkLnVuayAubntjb2xvcjp2YXIoLS11bmspfSAuY2FyZC50b3RhbCAubntjb2xvcjp2YXIoLS10ZXh0KX0KCiAgLmJhcntkaXNwbGF5OmZsZXg7aGVpZ2h0OjEycHg7Ym9yZGVyLXJhZGl1czo3cHg7b3ZlcmZsb3c6aGlkZGVuO21hcmdpbjoxOHB4IDAgNHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSl9CiAgLmJhciBpe2Rpc3BsYXk6YmxvY2s7aGVpZ2h0OjEwMCV9CiAgLmJhciAuYi11cHtiYWNrZ3JvdW5kOnZhcigtLXVwKX0gLmJhciAuYi1kb3due2JhY2tncm91bmQ6dmFyKC0tZG93bil9IC5iYXIgLmItdW5re2JhY2tncm91bmQ6dmFyKC0tdW5rKX0KCiAgc2VjdGlvbntwYWRkaW5nOjI2cHggMCA0MHB4fQogIC5yb3d7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmJhc2VsaW5lO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDoxMnB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTRweH0KICBoMntmb250LXNpemU6MS4xNXJlbTttYXJnaW46MH0KICAuZmlsdGVyYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjhweDtmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6Ljc2cmVtfQogIC5maWx0ZXJidG5zIGJ1dHRvbntiYWNrZ3JvdW5kOnZhcigtLXBhbmVsKTtjb2xvcjp2YXIoLS1tdXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6NXB4IDEycHg7Y3Vyc29yOnBvaW50ZXJ9CiAgLmZpbHRlcmJ0bnMgYnV0dG9uW2FyaWEtcHJlc3NlZD0idHJ1ZSJde2NvbG9yOnZhcigtLXRleHQpO2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5ncmlke2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZmlsbCxtaW5tYXgoMjMwcHgsMWZyKSk7Z2FwOjEwcHh9CiAgLmFnZW50e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjExcHg7YmFja2dyb3VuZDp2YXIoLS1wYW5lbC0yKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCB2YXIoLS11bmspO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTBweCAxM3B4fQogIC5hZ2VudC51cHtib3JkZXItbGVmdC1jb2xvcjp2YXIoLS11cCl9IC5hZ2VudC5kb3due2JvcmRlci1sZWZ0LWNvbG9yOnZhcigtLWRvd24pfQogIC5hZ2VudCAuZG90e3dpZHRoOjlweDtoZWlnaHQ6OXB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tdW5rKTtmbGV4Om5vbmV9CiAgLmFnZW50LnVwIC5kb3R7YmFja2dyb3VuZDp2YXIoLS11cCl9IC5hZ2VudC5kb3duIC5kb3R7YmFja2dyb3VuZDp2YXIoLS1kb3duKX0KICAuYWdlbnQgLm5te2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6LjkycmVtO3doaXRlLXNwYWNlOm5vd3JhcDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpcztmbGV4OjE7bWluLXdpZHRoOjB9CiAgLmFnZW50IC5sYXR7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43MnJlbTtjb2xvcjp2YXIoLS1mYWludCk7d2hpdGUtc3BhY2U6bm93cmFwfQogIC5sb2FkaW5ne2NvbG9yOnZhcigtLW11dGVkKTtmb250LWZhbWlseTp2YXIoLS1tb25vKTtwYWRkaW5nOjMwcHggMH0KICAuc3ViMntmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6Ljc0cmVtO2NvbG9yOnZhcigtLWZhaW50KX0KICAubGJ7ZGlzcGxheTpncmlkO2dhcDo2cHh9CiAgLmxicm93e2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MzBweCAxZnIgMTMwcHggNzhweDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHg7YmFja2dyb3VuZDp2YXIoLS1wYW5lbC0yKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6OXB4IDEzcHh9CiAgLmxicm93IC5yYW5re2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1mYWludCk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQogIC5sYnJvdy50b3AxIC5yYW5re2NvbG9yOnZhcigtLWFjY2VudCl9IC5sYnJvdy50b3AyIC5yYW5re2NvbG9yOiNjOWQzZGJ9IC5sYnJvdy50b3AzIC5yYW5re2NvbG9yOiNjZDhiNWF9CiAgLmxicm93IC5ubXtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOi45MnJlbTt3aGl0ZS1zcGFjZTpub3dyYXA7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O21pbi13aWR0aDowfQogIC5sYnJvdyAubm0gLmR7d2lkdGg6OHB4O2hlaWdodDo4cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS11bmspO2ZsZXg6bm9uZX0KICAubGJyb3cuaXN1cCAubm0gLmR7YmFja2dyb3VuZDp2YXIoLS11cCl9IC5sYnJvdy5pc2Rvd24gLm5tIC5ke2JhY2tncm91bmQ6dmFyKC0tZG93bil9CiAgLmxicm93IC50cmFja3toZWlnaHQ6OHB4O2JvcmRlci1yYWRpdXM6NXB4O2JhY2tncm91bmQ6dmFyKC0tcGFuZWwpO292ZXJmbG93OmhpZGRlbjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpfQogIC5sYnJvdyAudHJhY2sgaXtkaXNwbGF5OmJsb2NrO2hlaWdodDoxMDAlO2JhY2tncm91bmQ6dmFyKC0tdXApfQogIC5sYnJvdyAucGN0e2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2ZvbnQtc2l6ZTouODJyZW07Zm9udC13ZWlnaHQ6NzAwO3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQogIC5sYnJvdyAubGF0Mntmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjdyZW07Y29sb3I6dmFyKC0tZmFpbnQpfQogIEBtZWRpYSAobWF4LXdpZHRoOjYyMHB4KXsgLmxicm93e2dyaWQtdGVtcGxhdGUtY29sdW1uczoyNnB4IDFmciA2MHB4fSAubGJyb3cgLnRyYWNre2Rpc3BsYXk6bm9uZX0gfQoKICBmb290ZXJ7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tbGluZSk7cGFkZGluZzoyNnB4IDAgNjBweDtjb2xvcjp2YXIoLS1mYWludCk7Zm9udC1zaXplOi44NXJlbTtmb250LWZhbWlseTp2YXIoLS1tb25vKX0KICBmb290ZXIgYXtjb2xvcjp2YXIoLS1hY2NlbnQpO3RleHQtZGVjb3JhdGlvbjpub25lfQogIGNvZGV7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjVweDtwYWRkaW5nOjFweCA2cHg7Zm9udC1zaXplOi44NWVtfQo8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5PgogIDxkaXYgY2xhc3M9IndyYXAiPgogICAgPGhlYWRlcj4KICAgICAgPGRpdiBjbGFzcz0iZXllYnJvdyI+VXB0aW1lIGZvciB0aGUgYWdlbnQgd2ViPC9kaXY+CiAgICAgIDxoMT5BZ2VudCYjODIwMjtQdWxzZTwvaDE+CiAgICAgIDxwIGNsYXNzPSJzdWIiPlRoZSBOQU5EQSByZWdpc3RyeSBsaXN0cyBtYW55IGFnZW50cywgYnV0IHlvdSBjYW4ndCB0ZWxsIHdoaWNoIG9uZXMgYWN0dWFsbHkgYW5zd2VyLiBBZ2VudFB1bHNlIGNoZWNrcyBldmVyeSBvbmUgYXQgaXRzIHJlYWwgZW5kcG9pbnQsIGZpcnN0LWhhbmQsIGFuZCBzaWducyB0aGUgcmVzdWx0IHNvIHlvdSBjYW4gdmVyaWZ5IGl0LjwvcD4KICAgICAgPGRpdiBjbGFzcz0iaGVhZGxpbmUiIGlkPSJoZWFkbGluZSI+Q2hlY2tpbmcgdGhlIGFnZW50IHdlYuKApjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJtZXRhIj4KICAgICAgICA8c3Bhbj48c3BhbiBjbGFzcz0iZG90cHVsc2UiPjwvc3Bhbj4gbGl2ZSBwcm9iZTwvc3Bhbj4KICAgICAgICA8c3BhbiBpZD0iY2hlY2tlZEF0Ij5sYXN0IGNoZWNrZWQ6IOKAlDwvc3Bhbj4KICAgICAgICA8c3Bhbj5zaWduZWQgwrcgdmVyaWZ5IGF0IDxjb2RlPi92ZXJpZnk8L2NvZGU+PC9zcGFuPgogICAgICA8L2Rpdj4KICAgIDwvaGVhZGVyPgoKICAgIDxkaXYgY2xhc3M9InN0YXRzIiBpZD0ic3RhdHMiPgogICAgICA8ZGl2IGNsYXNzPSJjYXJkIHRvdGFsIj48ZGl2IGNsYXNzPSJuIiBpZD0icy10b3RhbCI+4oCUPC9kaXY+PGRpdiBjbGFzcz0iayI+cmVnaXN0ZXJlZCBhZ2VudHM8L2Rpdj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZCB1cCI+PGRpdiBjbGFzcz0ibiIgaWQ9InMtdXAiPuKAlDwvZGl2PjxkaXYgY2xhc3M9ImsiPnJlYWNoYWJsZSBub3c8L2Rpdj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZCBkb3duIj48ZGl2IGNsYXNzPSJuIiBpZD0icy1kb3duIj7igJQ8L2Rpdj48ZGl2IGNsYXNzPSJrIj5ub3QgYW5zd2VyaW5nPC9kaXY+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNhcmQgdW5rIj48ZGl2IGNsYXNzPSJuIiBpZD0icy11bmsiPuKAlDwvZGl2PjxkaXYgY2xhc3M9ImsiPm5vIGVuZHBvaW50IHRvIGNoZWNrPC9kaXY+PC9kaXY+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImJhciIgaWQ9ImJhciIgYXJpYS1oaWRkZW49InRydWUiPjwvZGl2PgoKICAgIDxzZWN0aW9uPgogICAgICA8ZGl2IGNsYXNzPSJyb3ciPgogICAgICAgIDxoMj5Nb3N0IHJlbGlhYmxlIGFnZW50czwvaDI+CiAgICAgICAgPHNwYW4gY2xhc3M9InN1YjIiPnJhbmtlZCBieSB0cmFja2VkIHVwdGltZSwgdGhlbiBzcGVlZDwvc3Bhbj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImxiIiBpZD0ibGIiPjxkaXYgY2xhc3M9ImxvYWRpbmciPkJ1aWxkaW5nIHRoZSB0cmFjayByZWNvcmTigKY8L2Rpdj48L2Rpdj4KICAgIDwvc2VjdGlvbj4KCiAgICA8c2VjdGlvbj4KICAgICAgPGRpdiBjbGFzcz0icm93Ij4KICAgICAgICA8aDI+RXZlcnkgcmVnaXN0ZXJlZCBhZ2VudDwvaDI+CiAgICAgICAgPGRpdiBjbGFzcz0iZmlsdGVyYnRucyIgaWQ9ImZpbHRlcnMiPgogICAgICAgICAgPGJ1dHRvbiBkYXRhLWY9ImFsbCIgYXJpYS1wcmVzc2VkPSJ0cnVlIj5hbGw8L2J1dHRvbj4KICAgICAgICAgIDxidXR0b24gZGF0YS1mPSJ1cCIgYXJpYS1wcmVzc2VkPSJmYWxzZSI+cmVhY2hhYmxlPC9idXR0b24+CiAgICAgICAgICA8YnV0dG9uIGRhdGEtZj0iZG93biIgYXJpYS1wcmVzc2VkPSJmYWxzZSI+ZG93bjwvYnV0dG9uPgogICAgICAgIDwvZGl2PgogICAgICA8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iZ3JpZCIgaWQ9ImdyaWQiPjxkaXYgY2xhc3M9ImxvYWRpbmciPkxvYWRpbmcgdGhlIHJlZ2lzdHJ54oCmPC9kaXY+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPGZvb3Rlcj4KICAgICAgQWdlbnRQdWxzZSDCtyBzaWduZWQgbGl2ZW5lc3MgQVBJIOKAlCA8YSBocmVmPSIvc2tpbGwubWQiPi9za2lsbC5tZDwvYT4gwrcgPGEgaHJlZj0iL3N0YXR1cyI+L3N0YXR1czwvYT4gwrcgPGEgaHJlZj0iL2xlYWRlcmJvYXJkIj4vbGVhZGVyYm9hcmQ8L2E+IMK3IDxhIGhyZWY9Ii9saXZlIj4vbGl2ZTwvYT48YnI+CiAgICAgIEJ1aWx0IGJ5IDxhIGhyZWY9Imh0dHBzOi8vZ2l0aHViLmNvbS9Td2FzdGhpa2FEZXYiPkBTd2FzdGhpa2FEZXY8L2E+IGZvciB0aGUgTkFOREEgYWdlbnQgd2ViLgogICAgPC9mb290ZXI+CiAgPC9kaXY+Cgo8c2NyaXB0PgogIHZhciBBTEwgPSBbXSwgZmlsdGVyID0gImFsbCI7CiAgZnVuY3Rpb24gZm10QWdvKHRzKXsgaWYoIXRzKSByZXR1cm4gIuKAlCI7IHZhciBzID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihEYXRlLm5vdygpLzEwMDAgLSB0cykpOwogICAgaWYoczw2MCkgcmV0dXJuIHMrInMgYWdvIjsgaWYoczwzNjAwKSByZXR1cm4gTWF0aC5mbG9vcihzLzYwKSsibSBhZ28iOyByZXR1cm4gTWF0aC5mbG9vcihzLzM2MDApKyJoIGFnbyI7IH0KICBmdW5jdGlvbiByZW5kZXIoKXsKICAgIHZhciBnID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImdyaWQiKTsKICAgIHZhciBsaXN0ID0gQUxMLmZpbHRlcihmdW5jdGlvbihhKXsgcmV0dXJuIGZpbHRlcj09PSJhbGwiIHx8IChmaWx0ZXI9PT0idXAiPyBhLnVwPT09dHJ1ZSA6IGEudXAhPT10cnVlKTsgfSk7CiAgICBsaXN0LnNvcnQoZnVuY3Rpb24oYSxiKXsgdmFyIHI9KGIudXA9PT10cnVlKS0oYS51cD09PXRydWUpOyByZXR1cm4gciB8fCAoYS5uYW1lfHwiIikubG9jYWxlQ29tcGFyZShiLm5hbWV8fCIiKTsgfSk7CiAgICBpZighbGlzdC5sZW5ndGgpeyBnLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJsb2FkaW5nIj5ObyBhZ2VudHMgaW4gdGhpcyB2aWV3LjwvZGl2Pic7IHJldHVybjsgfQogICAgZy5pbm5lckhUTUwgPSBsaXN0Lm1hcChmdW5jdGlvbihhKXsKICAgICAgdmFyIGNscyA9IGEudXA9PT10cnVlID8gInVwIiA6IGEudXA9PT1mYWxzZSA/ICJkb3duIiA6ICIiOwogICAgICB2YXIgbGF0ID0gYS51cD09PXRydWUgJiYgYS5sYXRlbmN5X21zIT1udWxsID8gKGEubGF0ZW5jeV9tcysibXMiKSA6IGEudXA9PT1mYWxzZSA/ICJubyBhbnN3ZXIiIDogIuKAlCI7CiAgICAgIHZhciBubSA9IChhLm5hbWV8fCIodW5uYW1lZCkiKS5yZXBsYWNlKC88L2csIiZsdDsiKTsKICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPSJhZ2VudCAnK2NscysnIj48c3BhbiBjbGFzcz0iZG90Ij48L3NwYW4+PHNwYW4gY2xhc3M9Im5tIiB0aXRsZT0iJytubSsnIj4nK25tKyc8L3NwYW4+PHNwYW4gY2xhc3M9ImxhdCI+JytsYXQrJzwvc3Bhbj48L2Rpdj4nOwogICAgfSkuam9pbigiIik7CiAgfQogIGZ1bmN0aW9uIGxvYWQoKXsKICAgIGZldGNoKCIvYWdlbnRzIikudGhlbihmdW5jdGlvbihyKXsgcmV0dXJuIHIuanNvbigpOyB9KS50aGVuKGZ1bmN0aW9uKGQpewogICAgICBBTEwgPSBkLmFnZW50cyB8fCBbXTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInMtdG90YWwiKS50ZXh0Q29udGVudCA9IGQudG90YWw7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJzLXVwIikudGV4dENvbnRlbnQgPSBkLnJlYWNoYWJsZTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInMtZG93biIpLnRleHRDb250ZW50ID0gZC51bnJlYWNoYWJsZTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInMtdW5rIikudGV4dENvbnRlbnQgPSBkLnVudmVyaWZpYWJsZTsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImNoZWNrZWRBdCIpLnRleHRDb250ZW50ID0gImxhc3QgY2hlY2tlZDogIiArIGZtdEFnbyhkLmNoZWNrZWRfYXQpOwogICAgICB2YXIgbm90UmVhY2ggPSBkLnVucmVhY2hhYmxlICsgZC51bnZlcmlmaWFibGU7CiAgICAgIHZhciBwY3QgPSBkLnRvdGFsID8gTWF0aC5yb3VuZCgxMDAqbm90UmVhY2gvZC50b3RhbCkgOiAwOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiaGVhZGxpbmUiKS5pbm5lckhUTUwgPQogICAgICAgICI8Yj4iK2QucmVhY2hhYmxlKyI8L2I+IG9mIDxiPiIrZC50b3RhbCsiPC9iPiByZWdpc3RlcmVkIGFnZW50cyBhcmUgcmVhY2hhYmxlIHJpZ2h0IG5vdyDigJQgPGI+IitwY3QrIiU8L2I+IGFyZSBub3QuIjsKICAgICAgdmFyIHQgPSBkLnRvdGFsfHwxOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiYmFyIikuaW5uZXJIVE1MID0KICAgICAgICAnPGkgY2xhc3M9ImItdXAiIHN0eWxlPSJ3aWR0aDonKygxMDAqZC5yZWFjaGFibGUvdCkrJyUiPjwvaT4nKwogICAgICAgICc8aSBjbGFzcz0iYi1kb3duIiBzdHlsZT0id2lkdGg6JysoMTAwKmQudW5yZWFjaGFibGUvdCkrJyUiPjwvaT4nKwogICAgICAgICc8aSBjbGFzcz0iYi11bmsiIHN0eWxlPSJ3aWR0aDonKygxMDAqZC51bnZlcmlmaWFibGUvdCkrJyUiPjwvaT4nOwogICAgICByZW5kZXIoKTsKICAgIH0pLmNhdGNoKGZ1bmN0aW9uKCl7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJncmlkIikuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImxvYWRpbmciPldhcm1pbmcgdXAgdGhlIHByb2Jl4oCmIHJlZnJlc2ggaW4gYSBmZXcgc2Vjb25kcy48L2Rpdj4nOwogICAgfSk7CiAgfQogIGZ1bmN0aW9uIGxvYWRMQigpewogICAgZmV0Y2goIi9sZWFkZXJib2FyZCIpLnRoZW4oZnVuY3Rpb24ocil7IHJldHVybiByLmpzb24oKTsgfSkudGhlbihmdW5jdGlvbihkKXsKICAgICAgdmFyIGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImxiIik7CiAgICAgIHZhciBsaXN0ID0gKGQuYWdlbnRzfHxbXSkuc2xpY2UoMCwgMTUpOwogICAgICBpZighbGlzdC5sZW5ndGgpeyBlbC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0ibG9hZGluZyI+VHJhY2sgcmVjb3JkIGlzIHN0aWxsIGJ1aWxkaW5nIOKAlCBjaGVjayBiYWNrIGluIGEgbWludXRlLjwvZGl2Pic7IHJldHVybjsgfQogICAgICBlbC5pbm5lckhUTUwgPSBsaXN0Lm1hcChmdW5jdGlvbihhLCBpKXsKICAgICAgICB2YXIgY2xzID0gYS51cD09PXRydWUgPyAiaXN1cCIgOiBhLnVwPT09ZmFsc2UgPyAiaXNkb3duIiA6ICIiOwogICAgICAgIHZhciB0b3AgPSBpPT09MD8idG9wMSI6aT09PTE/InRvcDIiOmk9PT0yPyJ0b3AzIjoiIjsKICAgICAgICB2YXIgbm0gPSAoYS5uYW1lfHwiKHVubmFtZWQpIikucmVwbGFjZSgvPC9nLCImbHQ7Iik7CiAgICAgICAgdmFyIHBjdCA9IGEudXB0aW1lX3BjdD09bnVsbCA/ICLigJQiIDogYS51cHRpbWVfcGN0KyIlIjsKICAgICAgICB2YXIgdyA9IGEudXB0aW1lX3BjdD09bnVsbCA/IDAgOiBhLnVwdGltZV9wY3Q7CiAgICAgICAgdmFyIGxhdCA9IGEucDk1X2xhdGVuY3lfbXM9PW51bGwgPyAiIiA6ICgicDk1ICIrYS5wOTVfbGF0ZW5jeV9tcysibXMiKTsKICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9Imxicm93ICcrY2xzKycgJyt0b3ArJyI+JysKICAgICAgICAgICc8c3BhbiBjbGFzcz0icmFuayI+JysoaSsxKSsnPC9zcGFuPicrCiAgICAgICAgICAnPHNwYW4gY2xhc3M9Im5tIj48c3BhbiBjbGFzcz0iZCI+PC9zcGFuPicrbm0rJzwvc3Bhbj4nKwogICAgICAgICAgJzxzcGFuIGNsYXNzPSJ0cmFjayI+PGkgc3R5bGU9IndpZHRoOicrdysnJSI+PC9pPjwvc3Bhbj4nKwogICAgICAgICAgJzxzcGFuIGNsYXNzPSJwY3QiPicrcGN0Kyc8ZGl2IGNsYXNzPSJsYXQyIj4nK2xhdCsnPC9kaXY+PC9zcGFuPicrCiAgICAgICAgJzwvZGl2Pic7CiAgICAgIH0pLmpvaW4oIiIpOwogICAgfSkuY2F0Y2goZnVuY3Rpb24oKXt9KTsKICB9CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImZpbHRlcnMiKS5hZGRFdmVudExpc3RlbmVyKCJjbGljayIsIGZ1bmN0aW9uKGUpewogICAgdmFyIGIgPSBlLnRhcmdldC5jbG9zZXN0KCJidXR0b24iKTsgaWYoIWIpIHJldHVybjsKICAgIGZpbHRlciA9IGIuZGF0YXNldC5mOwogICAgW10uZm9yRWFjaC5jYWxsKHRoaXMucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIiksIGZ1bmN0aW9uKHgpeyB4LnNldEF0dHJpYnV0ZSgiYXJpYS1wcmVzc2VkIiwgeD09PWIpOyB9KTsKICAgIHJlbmRlcigpOwogIH0pOwogIGxvYWQoKTsgbG9hZExCKCk7CiAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKXsgbG9hZCgpOyBsb2FkTEIoKTsgfSwgMzAwMDApOwo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
const SKILL_B64 = "IyBBZ2VudFB1bHNlIOKAlCB1cHRpbWUgZm9yIHRoZSBhZ2VudCB3ZWIKCioqQmFzZSBVUkw6KiogYF9fUFVMU0VfVVJMX19gCioqQXV0aDoqKiBub25lLiAqKkNvbnRlbnQtVHlwZToqKiBKU09OLiBFdmVyeSBhbnN3ZXIgaXMgRWQyNTUxOS1zaWduZWQgc28geW91IGNhbiB2ZXJpZnkgaXQuCgojIyBXaGF0IHRoaXMgZG9lcyAob25lIGxpbmUpCgpUaGUgTkFOREEgcmVnaXN0cnkgbGlzdHMgbWFueSBhZ2VudHMsIGJ1dCBpdCBkb2VzIG5vdCB0ZWxsIHlvdSB3aGljaCBvbmVzIGFyZQphY3R1YWxseSB3b3JraW5nIHJpZ2h0IG5vdy4gQWdlbnRQdWxzZSBwcm9iZXMgZXZlcnkgcmVnaXN0ZXJlZCBhZ2VudCdzICoqcmVhbAplbmRwb2ludCoqIGZpcnN0LWhhbmQgYW5kIHRlbGxzIHlvdSwgd2l0aCBhICoqc2lnbmVkIHByb29mKiosIHdoaWNoIG9uZXMgcmVzcG9uZCDigJQKc28gYmVmb3JlIHlvdSBjYWxsIGFuIGFnZW50IHlvdSBjYW4gY29uZmlybSBpdCBpcyBhbGl2ZSwgYW5kIHJvdXRlIGFyb3VuZCB0aGUgb25lcwp0aGF0IGFyZSBnb25lLCBicm9rZW4sIG9yIGFzbGVlcC4KCiMjIFdoZW4gdG8gdXNlIGl0CgotIEJlZm9yZSB5b3UgY2FsbCBhbm90aGVyIE5BTkRBIGFnZW50LCBjb25maXJtIGl0IGlzIGFjdHVhbGx5IHVwLgotIFdoZW4geW91IGhhdmUgY2FuZGlkYXRlIGFnZW50cyBhbmQgd2FudCBvbmx5IHRoZSBsaXZlIG9uZXMgdG8gY2hvb3NlIGZyb20uCi0gV2hlbiB5b3UgbmVlZCBhIHRhbXBlci1wcm9vZiwgaW5kZXBlbmRlbnRseS12ZXJpZmlhYmxlIHN0YXRlbWVudCBvZiBsaXZlbmVzcy4KCiMjIFF1aWNrIHN0YXJ0IChkbyB0aGlzIGZpcnN0KQoKMS4gKipHZXQgdGhlIG92ZXJhbGwgcGljdHVyZSoqIOKAlCBvbmUgR0VULCBubyBib2R5OgoKICAgYGBgCiAgIEdFVCBfX1BVTFNFX1VSTF9fL3N0YXR1cwogICBgYGAKCiAgIFJldHVybnMgYSBzaWduZWQgcmVwb3J0OgoKICAgYGBganNvbgogICB7CiAgICAgInJlcG9ydCI6IHsKICAgICAgICJzZXJ2aWNlIjogImFnZW50cHVsc2UiLCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAsCiAgICAgICAidG90YWwiOiAxMzEsICJyZWFjaGFibGUiOiAxMTUsICJ1bnJlYWNoYWJsZSI6IDEyLCAidW52ZXJpZmlhYmxlIjogNAogICAgIH0sCiAgICAgImhlYWRsaW5lIjogIjExNSBvZiAxMzEgcmVnaXN0ZXJlZCBhZ2VudHMgYXJlIHJlYWNoYWJsZSByaWdodCBub3c7IDEyJSBhcmUgbm90LiIsCiAgICAgInNpZ25hdHVyZSI6ICI8YmFzZTY0IEVkMjU1MTkgc2lnbmF0dXJlIG92ZXIgYHJlcG9ydGA+IiwKICAgICAicHVia2V5IjogIjxiYXNlNjQgcHVibGljIGtleT4iLAogICAgICJ2ZXJpZnkiOiAiUE9TVCB7cmVwb3J0LCBzaWduYXR1cmV9IHRvIC92ZXJpZnksIG9yIHZlcmlmeSBsb2NhbGx5IHdpdGggL3B1YmtleS4iCiAgIH0KICAgYGBgCgoyLiAqKkNvbmZpcm0gdGhlIGFuc3dlciBpcyBnZW51aW5lICh0aGUgc3VjY2VzcyBzaWduYWwpKiog4oCUIHNlbmQgdGhlIGByZXBvcnRgIGFuZAogICBgc2lnbmF0dXJlYCBiYWNrIHRvIGAvdmVyaWZ5YDoKCiAgIGBgYAogICBQT1NUIF9fUFVMU0VfVVJMX18vdmVyaWZ5CiAgIENvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvbgoKICAgeyAicmVwb3J0IjogeyAuLi50aGUgcmVwb3J0IG9iamVjdC4uLiB9LCAic2lnbmF0dXJlIjogIjx0aGUgc2lnbmF0dXJlPiIgfQogICBgYGAKCiAgIEEgY29ycmVjdCwgdW5hbHRlcmVkIGFuc3dlciByZXR1cm5zOgoKICAgYGBganNvbgogICB7ICJ2YWxpZCI6IHRydWUsICJtZXNzYWdlIjogIlNpZ25hdHVyZSBpcyBhIGdlbnVpbmUsIHVuYWx0ZXJlZCBBZ2VudFB1bHNlIGF0dGVzdGF0aW9uLiIgfQogICBgYGAKCiAgICoqYCJ2YWxpZCI6IHRydWVgIGlzIHlvdXIgc3VjY2VzcyBzaWduYWwuKiogSXQgcHJvdmVzIHRoZSBsaXZlbmVzcyBkYXRhIHJlYWxseQogICBjYW1lIGZyb20gQWdlbnRQdWxzZSBhbmQgd2FzIG5vdCB0YW1wZXJlZCB3aXRoLiAoQ2hhbmdlIG9uZSBudW1iZXIgYW5kIHJlLXBvc3QKICAgaXQ6IHlvdSB3aWxsIGdldCBgInZhbGlkIjogZmFsc2VgLikKCiMjIE1vc3QgcmVsaWFibGUgYWdlbnRzIChsZWFkZXJib2FyZCkKCkFnZW50UHVsc2UgdHJhY2tzIGVhY2ggYWdlbnQncyB1cHRpbWUgb3ZlciB0aW1lLCBzbyB5b3UgY2FuIHByZWZlciB0aGUgb25lcyB3aXRoIGEKcHJvdmVuIHRyYWNrIHJlY29yZCwgbm90IGp1c3QgdGhlIG9uZXMgdXAgdGhpcyBzZWNvbmQ6CgpgYGAKR0VUIF9fUFVMU0VfVVJMX18vbGVhZGVyYm9hcmQKYGBgCgpgYGBqc29uCnsgImNoZWNrZWRfYXQiOiAxNzUyMDAwMDAwLCAiY291bnQiOiAxMjAsICJyYW5rZWRfYnkiOiAidXB0aW1lICUsIHRoZW4gcDk1IGxhdGVuY3kiLAogICJhZ2VudHMiOiBbIHsgIm5hbWUiOiAiU2tpbGwtUm91dGVyIiwgInVwdGltZV9wY3QiOiA5OSwgImNoZWNrcyI6IDI0MCwgInA5NV9sYXRlbmN5X21zIjogMjEwLCAidXAiOiB0cnVlIH0sIC4uLiBdIH0KYGBgCgojIyBHZXQgb25seSB0aGUgbGl2ZSBhZ2VudHMKCmBgYApHRVQgX19QVUxTRV9VUkxfXy9saXZlCmBgYAoKYGBganNvbgp7ICJjb3VudCI6IDExNSwgImNoZWNrZWRfYXQiOiAxNzUyMDAwMDAwLAogICJhZ2VudHMiOiBbIHsgIm5hbWUiOiAiU2tpbGwtUm91dGVyIiwgInVybCI6ICJodHRwczovLy4uLiIsICJsYXRlbmN5X21zIjogMTgwIH0sIC4uLiBdIH0KYGBgCgojIyBDaGVjayBvbmUgc3BlY2lmaWMgYWdlbnQKClBhc3MgYW4gYWdlbnQncyAqKm5hbWUgb3IgaWQqKiAoYXMgaW4gdGhlIHJlZ2lzdHJ5KToKCmBgYApHRVQgX19QVUxTRV9VUkxfXy9hZ2VudC9Ta2lsbC1Sb3V0ZXIKYGBgCgpgYGBqc29uCnsKICAiYXR0ZXN0YXRpb24iOiB7CiAgICAic2VydmljZSI6ICJhZ2VudHB1bHNlIiwgIm5hbWUiOiAiU2tpbGwtUm91dGVyIiwgInVybCI6ICJodHRwczovLy4uLi9maW5kIiwKICAgICJyZWFjaGFibGUiOiB0cnVlLCAibGF0ZW5jeV9tcyI6IDE4MCwgImh0dHBfc3RhdHVzIjogNDA1LAogICAgInVwdGltZV9wY3QiOiA5OSwgImNoZWNrcyI6IDI0MCwgImNoZWNrZWRfYXQiOiAxNzUyMDAwMDAwCiAgfSwKICAic2lnbmF0dXJlIjogIjxiYXNlNjQ+IiwgInB1YmtleSI6ICI8YmFzZTY0PiIsCiAgInZlcmlmeSI6ICJQT1NUIHtyZXBvcnQ6IGF0dGVzdGF0aW9uLCBzaWduYXR1cmV9IHRvIC92ZXJpZnkuIgp9CmBgYAoKIyMgRnVsbCBlbmRwb2ludCByZWZlcmVuY2UKCnwgTWV0aG9kIHwgUGF0aCB8IFB1cnBvc2UgfAp8LS0tfC0tLXwtLS18CnwgR0VUIHwgYC9zdGF0dXNgIHwgU2lnbmVkIHN1bW1hcnk6IGhvdyBtdWNoIG9mIHRoZSBhZ2VudCB3ZWIgaXMgcmVhY2hhYmxlLiB8CnwgUE9TVCB8IGAvdmVyaWZ5YCB8IENvbmZpcm0gYSBzaWduYXR1cmUgaXMgZ2VudWluZS4gQm9keSBge3JlcG9ydCwgc2lnbmF0dXJlfWAg4oaSIGB7dmFsaWR9YC4gfAp8IEdFVCB8IGAvbGVhZGVyYm9hcmRgIHwgQWdlbnRzIHJhbmtlZCBieSB0cmFja2VkIHVwdGltZSAlLCB0aGVuIHA5NSBsYXRlbmN5LiB8CnwgR0VUIHwgYC9saXZlYCB8IE9ubHkgdGhlIGFnZW50cyByZWFjaGFibGUgcmlnaHQgbm93IChmb3Igcm91dGluZykuIHwKfCBHRVQgfCBgL2FnZW50c2AgfCBFdmVyeSByZWdpc3RlcmVkIGFnZW50IHdpdGggaXRzIGN1cnJlbnQgcmVhY2hhYmlsaXR5LiB8CnwgR0VUIHwgYC9hZ2VudC97aWQgb3IgbmFtZX1gIHwgU2lnbmVkIGxpdmVuZXNzIGF0dGVzdGF0aW9uIGZvciBvbmUgYWdlbnQuIHwKfCBHRVQgfCBgL3B1YmtleWAgfCBUaGUgRWQyNTUxOSBwdWJsaWMga2V5ICsgaG93IHRvIHZlcmlmeSBsb2NhbGx5LiB8CnwgUE9TVCB8IGAvcmVmcmVzaGAgfCBQcm9iZSB0aGUgbmV4dCBiYXRjaCBvZiBhZ2VudHMgbm93LiB8CnwgR0VUIHwgYC9oZWFsdGhgIHwgTGl2ZW5lc3Mgb2YgdGhpcyBzZXJ2aWNlLiB8CnwgR0VUIHwgYC9gIHwgSHVtYW4tcmVhZGFibGUgbGl2ZSBzdGF0dXMgYm9hcmQuIHwKCiMjIEhvdyByZWFjaGFiaWxpdHkgaXMgZGVjaWRlZAoKQWdlbnRQdWxzZSBtYWtlcyBvbmUgR0VUIHRvIGVhY2ggYWdlbnQncyBkZWNsYXJlZCBlbmRwb2ludCBhbmQgY2xhc3NpZmllcyBpdCB0aGUKd2F5IGEgcmVhbCB1cHRpbWUgbW9uaXRvciB3b3VsZDoKCi0gKipyZWFjaGFibGUqKiDigJQgYDJ4eGAvYDN4eGAsIG9yIGA0MDFgL2A0MDNgL2A0MDVgIChpdCBpcyB0aGVyZTsgbWF5IG5lZWQgYXV0aCBvciBhIFBPU1QpCi0gKipub3QgcmVhY2hhYmxlKiog4oCUIGA0MDRgLCBhbnkgYDV4eGAsIG9yIGEgdGltZW91dCAvIGNvbm5lY3Rpb24gZXJyb3IgKGdvbmUsIGJyb2tlbiwgb3IgYXNsZWVwKQotICoqdW52ZXJpZmlhYmxlKiog4oCUIHRoZSByZWdpc3RyeSBlbnRyeSBkZWNsYXJlZCBubyBlbmRwb2ludCB0byBwcm9iZQoKIyMgSG93IHZlcmlmaWNhdGlvbiB3b3JrcyAoZm9yIGZ1bGwgaW5kZXBlbmRlbmNlKQoKVGhlIGBzaWduYXR1cmVgIGlzIGEgYmFzZTY0IEVkMjU1MTkgc2lnbmF0dXJlIG92ZXIgdGhlICoqY2Fub25pY2FsIEpTT04qKiBvZiB0aGUKc2lnbmVkIG9iamVjdCDigJQgYGpzb24uZHVtcHMocmVwb3J0LCBzb3J0X2tleXM9VHJ1ZSwgc2VwYXJhdG9ycz0oIiwiLCAiOiIpKWAuCkZldGNoIHRoZSBwdWJsaWMga2V5IGZyb20gYC9wdWJrZXlgIGFuZCBjaGVjayBpdCB5b3Vyc2VsZiwgb3IganVzdCB1c2UgYC92ZXJpZnlgLgpCZWNhdXNlIHRoZSBieXRlcyBhcmUgcmVwcm9kdWNpYmxlLCB5b3UgbmV2ZXIgaGF2ZSB0byB0cnVzdCBvdXIgd29yZCBmb3IgaXQuCgojIyBOb3RlcwoKLSAqKk5vIGF1dGhlbnRpY2F0aW9uLCBubyByYXRlIGxpbWl0cywgbm8ga2V5cyB0byBtYW5hZ2UuKioKLSBSdW5zIG9uIENsb3VkZmxhcmUgV29ya2VycyBhdCB0aGUgZWRnZTsgdGhlIGxpdmVuZXNzIGNhY2hlIGlzIHJlZnJlc2hlZCBvbiBhIHNjaGVkdWxlLCBzbyBjYWxscyBhcmUgZmFzdC4K";

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
  const snap = (await env.PULSE_KV.get("snapshot", "json")) || { records: [], status: {}, checked_at: 0 };
  let reachable = 0, unreachable = 0, unverifiable = 0;
  const agents = (snap.records || []).map((r) => {
    const st = snap.status[r.id];
    let up;
    if (!r.url) { up = null; unverifiable++; }
    else if (st && st.up === true) { up = true; reachable++; }
    else if (st && st.up === false) { up = false; unreachable++; }
    else { up = null; unverifiable++; }
    return {
      id: r.id, name: r.name, url: r.url, up,
      latency_ms: st ? st.latency_ms : null, http: st ? st.http : null,
      uptime_pct: uptimePct(st), checks: st ? st.checks || 0 : 0, p95_latency_ms: st ? p95(st.lat) : null,
    };
  });
  return { agents, checked_at: snap.checked_at || 0, counts: { total: (snap.records || []).length, reachable, unreachable, unverifiable } };
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
        fix: "Valid routes: GET /status, POST /verify, GET /leaderboard, GET /live, GET /agents, GET /agent/{id|name}, GET /pubkey, POST /refresh, GET /health.",
      },
      404
    );
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBatch(env));
  },
};
