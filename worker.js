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

const BOARD_B64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xIj4KPHRpdGxlPkFnZW50UHVsc2Ug4oCUIGlzIHRoZSBhZ2VudCB3ZWIgYWxpdmU/PC90aXRsZT4KPG1ldGEgbmFtZT0iZGVzY3JpcHRpb24iIGNvbnRlbnQ9IkxpdmUsIHNpZ25lZCB1cHRpbWUgZm9yIGV2ZXJ5IGFnZW50IGluIHRoZSBOQU5EQSByZWdpc3RyeS4gU2VlIHdoaWNoIGFnZW50cyBhY3R1YWxseSBhbnN3ZXIgcmlnaHQgbm93LiI+CjxsaW5rIHJlbD0iaWNvbiIgaHJlZj0iZGF0YTppbWFnZS9zdmcreG1sLCUzQ3N2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJyUzRSUzQ3RleHQgeT0nLjllbScgZm9udC1zaXplPSc5MCclM0UlRjAlOUYlOTIlOTMlM0MvdGV4dCUzRSUzQy9zdmclM0UiPgo8c3R5bGU+CiAgOnJvb3R7CiAgICAtLWJnOiMwZDExMTc7IC0tcGFuZWw6IzEzMWMyNjsgLS1wYW5lbC0yOiMwZjE3MjA7IC0tbGluZTojMjMzMjQwOwogICAgLS10ZXh0OiNlOGVlZjQ7IC0tbXV0ZWQ6IzkzYTZiNDsgLS1mYWludDojNWY3MjgwOwogICAgLS11cDojM2ZiOTZiOyAtLWRvd246I2UyNjA0YTsgLS11bms6IzdjOGE5NzsgLS1hY2NlbnQ6I2U3YTMzZjsKICAgIC0tbW9ubzp1aS1tb25vc3BhY2UsIkNhc2NhZGlhIENvZGUiLCJTRiBNb25vIiwiSmV0QnJhaW5zIE1vbm8iLE1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTsKICAgIC0tc2FuczpzeXN0ZW0tdWksLWFwcGxlLXN5c3RlbSwiU2Vnb2UgVUkiLFJvYm90bywiSGVsdmV0aWNhIE5ldWUiLEFyaWFsLHNhbnMtc2VyaWY7CiAgfQogICp7Ym94LXNpemluZzpib3JkZXItYm94fQogIGJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdGV4dCk7Zm9udC1mYW1pbHk6dmFyKC0tc2Fucyk7bGluZS1oZWlnaHQ6MS42OwogICAgYmFja2dyb3VuZC1pbWFnZTpyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDE1JSAtMTAlLCByZ2JhKDIzMSwxNjMsNjMsLjA4KSwgdHJhbnNwYXJlbnQgNDAlKSxyYWRpYWwtZ3JhZGllbnQoY2lyY2xlIGF0IDEwMCUgMCUsIHJnYmEoNjMsMTg1LDEwNywuMDcpLCB0cmFuc3BhcmVudCAzNSUpfQogIC53cmFwe21heC13aWR0aDoxMDgwcHg7bWFyZ2luOjAgYXV0bztwYWRkaW5nOjAgMjJweH0KICBoZWFkZXJ7cGFkZGluZzo1NnB4IDAgMjJweH0KICAuZXllYnJvd3tmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6LjcycmVtO2xldHRlci1zcGFjaW5nOi4yZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOnZhcigtLWFjY2VudCl9CiAgaDF7Zm9udC1zaXplOmNsYW1wKDJyZW0sNS41dncsMy4zcmVtKTtmb250LXdlaWdodDo4NTA7bGV0dGVyLXNwYWNpbmc6LS4wM2VtO21hcmdpbjoxMnB4IDAgMTBweDtsaW5lLWhlaWdodDoxfQogIC5zdWJ7Y29sb3I6dmFyKC0tbXV0ZWQpO21heC13aWR0aDo2NDBweDtmb250LXNpemU6MS4wOHJlbX0KICAuaGVhZGxpbmV7bWFyZ2luOjI2cHggMCA2cHg7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOmNsYW1wKDFyZW0sMi40dncsMS4zNXJlbSk7Zm9udC13ZWlnaHQ6NjAwfQogIC5oZWFkbGluZSBie2NvbG9yOnZhcigtLWFjY2VudCl9CiAgLm1ldGF7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43OHJlbTtjb2xvcjp2YXIoLS1mYWludCk7ZGlzcGxheTpmbGV4O2dhcDoxNnB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcn0KICAuZG90cHVsc2V7d2lkdGg6OHB4O2hlaWdodDo4cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS11cCk7ZGlzcGxheTppbmxpbmUtYmxvY2s7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywuNik7YW5pbWF0aW9uOnB1bHNlIDIuNHMgaW5maW5pdGV9CiAgQGtleWZyYW1lcyBwdWxzZXswJXtib3gtc2hhZG93OjAgMCAwIDAgcmdiYSg2MywxODUsMTA3LC41KX03MCV7Ym94LXNoYWRvdzowIDAgMCA3cHggcmdiYSg2MywxODUsMTA3LDApfTEwMCV7Ym94LXNoYWRvdzowIDAgMCAwIHJnYmEoNjMsMTg1LDEwNywwKX19CiAgQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOiByZWR1Y2Upey5kb3RwdWxzZXthbmltYXRpb246bm9uZX19CgogIC5zdGF0c3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTUwcHgsMWZyKSk7Z2FwOjE0cHg7bWFyZ2luOjI2cHggMCA4cHh9CiAgLmNhcmR7YmFja2dyb3VuZDp2YXIoLS1wYW5lbCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxOHB4IDIwcHh9CiAgLmNhcmQgLm57Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC13ZWlnaHQ6ODAwO2ZvbnQtc2l6ZToyLjFyZW07bGV0dGVyLXNwYWNpbmc6LS4wMmVtO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc30KICAuY2FyZCAua3tjb2xvcjp2YXIoLS1tdXRlZCk7Zm9udC1zaXplOi44NXJlbTttYXJnaW4tdG9wOjJweH0KICAuY2FyZC51cCAubntjb2xvcjp2YXIoLS11cCl9IC5jYXJkLmRvd24gLm57Y29sb3I6dmFyKC0tZG93bil9IC5jYXJkLnVuayAubntjb2xvcjp2YXIoLS11bmspfSAuY2FyZC50b3RhbCAubntjb2xvcjp2YXIoLS10ZXh0KX0KCiAgLmJhcntkaXNwbGF5OmZsZXg7aGVpZ2h0OjEycHg7Ym9yZGVyLXJhZGl1czo3cHg7b3ZlcmZsb3c6aGlkZGVuO21hcmdpbjoxOHB4IDAgNHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSl9CiAgLmJhciBpe2Rpc3BsYXk6YmxvY2s7aGVpZ2h0OjEwMCV9CiAgLmJhciAuYi11cHtiYWNrZ3JvdW5kOnZhcigtLXVwKX0gLmJhciAuYi1kb3due2JhY2tncm91bmQ6dmFyKC0tZG93bil9IC5iYXIgLmItdW5re2JhY2tncm91bmQ6dmFyKC0tdW5rKX0KCiAgc2VjdGlvbntwYWRkaW5nOjI2cHggMCA0MHB4fQogIC5yb3d7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmJhc2VsaW5lO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dhcDoxMnB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTRweH0KICBoMntmb250LXNpemU6MS4xNXJlbTttYXJnaW46MH0KICAuZmlsdGVyYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjhweDtmb250LWZhbWlseTp2YXIoLS1tb25vKTtmb250LXNpemU6Ljc2cmVtfQogIC5maWx0ZXJidG5zIGJ1dHRvbntiYWNrZ3JvdW5kOnZhcigtLXBhbmVsKTtjb2xvcjp2YXIoLS1tdXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6NXB4IDEycHg7Y3Vyc29yOnBvaW50ZXJ9CiAgLmZpbHRlcmJ0bnMgYnV0dG9uW2FyaWEtcHJlc3NlZD0idHJ1ZSJde2NvbG9yOnZhcigtLXRleHQpO2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpfQogIC5ncmlke2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZmlsbCxtaW5tYXgoMjMwcHgsMWZyKSk7Z2FwOjEwcHh9CiAgLmFnZW50e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjExcHg7YmFja2dyb3VuZDp2YXIoLS1wYW5lbC0yKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxpbmUpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCB2YXIoLS11bmspO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTBweCAxM3B4fQogIC5hZ2VudC51cHtib3JkZXItbGVmdC1jb2xvcjp2YXIoLS11cCl9IC5hZ2VudC5kb3due2JvcmRlci1sZWZ0LWNvbG9yOnZhcigtLWRvd24pfQogIC5hZ2VudCAuZG90e3dpZHRoOjlweDtoZWlnaHQ6OXB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tdW5rKTtmbGV4Om5vbmV9CiAgLmFnZW50LnVwIC5kb3R7YmFja2dyb3VuZDp2YXIoLS11cCl9IC5hZ2VudC5kb3duIC5kb3R7YmFja2dyb3VuZDp2YXIoLS1kb3duKX0KICAuYWdlbnQgLm5te2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6LjkycmVtO3doaXRlLXNwYWNlOm5vd3JhcDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpcztmbGV4OjE7bWluLXdpZHRoOjB9CiAgLmFnZW50IC5sYXR7Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyk7Zm9udC1zaXplOi43MnJlbTtjb2xvcjp2YXIoLS1mYWludCk7d2hpdGUtc3BhY2U6bm93cmFwfQogIC5sb2FkaW5ne2NvbG9yOnZhcigtLW11dGVkKTtmb250LWZhbWlseTp2YXIoLS1tb25vKTtwYWRkaW5nOjMwcHggMH0KCiAgZm9vdGVye2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWxpbmUpO3BhZGRpbmc6MjZweCAwIDYwcHg7Y29sb3I6dmFyKC0tZmFpbnQpO2ZvbnQtc2l6ZTouODVyZW07Zm9udC1mYW1pbHk6dmFyKC0tbW9ubyl9CiAgZm9vdGVyIGF7Y29sb3I6dmFyKC0tYWNjZW50KTt0ZXh0LWRlY29yYXRpb246bm9uZX0KICBjb2Rle2ZvbnQtZmFtaWx5OnZhcigtLW1vbm8pO2JhY2tncm91bmQ6dmFyKC0tcGFuZWwpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czo1cHg7cGFkZGluZzoxcHggNnB4O2ZvbnQtc2l6ZTouODVlbX0KPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KICA8ZGl2IGNsYXNzPSJ3cmFwIj4KICAgIDxoZWFkZXI+CiAgICAgIDxkaXYgY2xhc3M9ImV5ZWJyb3ciPlVwdGltZSBmb3IgdGhlIGFnZW50IHdlYjwvZGl2PgogICAgICA8aDE+QWdlbnQmIzgyMDI7UHVsc2U8L2gxPgogICAgICA8cCBjbGFzcz0ic3ViIj5UaGUgTkFOREEgcmVnaXN0cnkgbGlzdHMgbWFueSBhZ2VudHMsIGJ1dCB5b3UgY2FuJ3QgdGVsbCB3aGljaCBvbmVzIGFjdHVhbGx5IGFuc3dlci4gQWdlbnRQdWxzZSBjaGVja3MgZXZlcnkgb25lIGF0IGl0cyByZWFsIGVuZHBvaW50LCBmaXJzdC1oYW5kLCBhbmQgc2lnbnMgdGhlIHJlc3VsdCBzbyB5b3UgY2FuIHZlcmlmeSBpdC48L3A+CiAgICAgIDxkaXYgY2xhc3M9ImhlYWRsaW5lIiBpZD0iaGVhZGxpbmUiPkNoZWNraW5nIHRoZSBhZ2VudCB3ZWLigKY8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0ibWV0YSI+CiAgICAgICAgPHNwYW4+PHNwYW4gY2xhc3M9ImRvdHB1bHNlIj48L3NwYW4+IGxpdmUgcHJvYmU8L3NwYW4+CiAgICAgICAgPHNwYW4gaWQ9ImNoZWNrZWRBdCI+bGFzdCBjaGVja2VkOiDigJQ8L3NwYW4+CiAgICAgICAgPHNwYW4+c2lnbmVkIMK3IHZlcmlmeSBhdCA8Y29kZT4vdmVyaWZ5PC9jb2RlPjwvc3Bhbj4KICAgICAgPC9kaXY+CiAgICA8L2hlYWRlcj4KCiAgICA8ZGl2IGNsYXNzPSJzdGF0cyIgaWQ9InN0YXRzIj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZCB0b3RhbCI+PGRpdiBjbGFzcz0ibiIgaWQ9InMtdG90YWwiPuKAlDwvZGl2PjxkaXYgY2xhc3M9ImsiPnJlZ2lzdGVyZWQgYWdlbnRzPC9kaXY+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNhcmQgdXAiPjxkaXYgY2xhc3M9Im4iIGlkPSJzLXVwIj7igJQ8L2Rpdj48ZGl2IGNsYXNzPSJrIj5yZWFjaGFibGUgbm93PC9kaXY+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNhcmQgZG93biI+PGRpdiBjbGFzcz0ibiIgaWQ9InMtZG93biI+4oCUPC9kaXY+PGRpdiBjbGFzcz0iayI+bm90IGFuc3dlcmluZzwvZGl2PjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJjYXJkIHVuayI+PGRpdiBjbGFzcz0ibiIgaWQ9InMtdW5rIj7igJQ8L2Rpdj48ZGl2IGNsYXNzPSJrIj5ubyBlbmRwb2ludCB0byBjaGVjazwvZGl2PjwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJiYXIiIGlkPSJiYXIiIGFyaWEtaGlkZGVuPSJ0cnVlIj48L2Rpdj4KCiAgICA8c2VjdGlvbj4KICAgICAgPGRpdiBjbGFzcz0icm93Ij4KICAgICAgICA8aDI+RXZlcnkgcmVnaXN0ZXJlZCBhZ2VudDwvaDI+CiAgICAgICAgPGRpdiBjbGFzcz0iZmlsdGVyYnRucyIgaWQ9ImZpbHRlcnMiPgogICAgICAgICAgPGJ1dHRvbiBkYXRhLWY9ImFsbCIgYXJpYS1wcmVzc2VkPSJ0cnVlIj5hbGw8L2J1dHRvbj4KICAgICAgICAgIDxidXR0b24gZGF0YS1mPSJ1cCIgYXJpYS1wcmVzc2VkPSJmYWxzZSI+cmVhY2hhYmxlPC9idXR0b24+CiAgICAgICAgICA8YnV0dG9uIGRhdGEtZj0iZG93biIgYXJpYS1wcmVzc2VkPSJmYWxzZSI+ZG93bjwvYnV0dG9uPgogICAgICAgIDwvZGl2PgogICAgICA8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iZ3JpZCIgaWQ9ImdyaWQiPjxkaXYgY2xhc3M9ImxvYWRpbmciPkxvYWRpbmcgdGhlIHJlZ2lzdHJ54oCmPC9kaXY+PC9kaXY+CiAgICA8L3NlY3Rpb24+CgogICAgPGZvb3Rlcj4KICAgICAgQWdlbnRQdWxzZSDCtyBzaWduZWQgbGl2ZW5lc3MgQVBJIOKAlCA8YSBocmVmPSIvc2tpbGwubWQiPi9za2lsbC5tZDwvYT4gwrcgPGEgaHJlZj0iL3N0YXR1cyI+L3N0YXR1czwvYT4gwrcgPGEgaHJlZj0iL2xpdmUiPi9saXZlPC9hPjxicj4KICAgICAgQnVpbHQgYnkgPGEgaHJlZj0iaHR0cHM6Ly9naXRodWIuY29tL1N3YXN0aGlrYURldiI+QFN3YXN0aGlrYURldjwvYT4gZm9yIHRoZSBOQU5EQSBhZ2VudCB3ZWIuCiAgICA8L2Zvb3Rlcj4KICA8L2Rpdj4KCjxzY3JpcHQ+CiAgdmFyIEFMTCA9IFtdLCBmaWx0ZXIgPSAiYWxsIjsKICBmdW5jdGlvbiBmbXRBZ28odHMpeyBpZighdHMpIHJldHVybiAi4oCUIjsgdmFyIHMgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKERhdGUubm93KCkvMTAwMCAtIHRzKSk7CiAgICBpZihzPDYwKSByZXR1cm4gcysicyBhZ28iOyBpZihzPDM2MDApIHJldHVybiBNYXRoLmZsb29yKHMvNjApKyJtIGFnbyI7IHJldHVybiBNYXRoLmZsb29yKHMvMzYwMCkrImggYWdvIjsgfQogIGZ1bmN0aW9uIHJlbmRlcigpewogICAgdmFyIGcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZ3JpZCIpOwogICAgdmFyIGxpc3QgPSBBTEwuZmlsdGVyKGZ1bmN0aW9uKGEpeyByZXR1cm4gZmlsdGVyPT09ImFsbCIgfHwgKGZpbHRlcj09PSJ1cCI/IGEudXA9PT10cnVlIDogYS51cCE9PXRydWUpOyB9KTsKICAgIGxpc3Quc29ydChmdW5jdGlvbihhLGIpeyB2YXIgcj0oYi51cD09PXRydWUpLShhLnVwPT09dHJ1ZSk7IHJldHVybiByIHx8IChhLm5hbWV8fCIiKS5sb2NhbGVDb21wYXJlKGIubmFtZXx8IiIpOyB9KTsKICAgIGlmKCFsaXN0Lmxlbmd0aCl7IGcuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImxvYWRpbmciPk5vIGFnZW50cyBpbiB0aGlzIHZpZXcuPC9kaXY+JzsgcmV0dXJuOyB9CiAgICBnLmlubmVySFRNTCA9IGxpc3QubWFwKGZ1bmN0aW9uKGEpewogICAgICB2YXIgY2xzID0gYS51cD09PXRydWUgPyAidXAiIDogYS51cD09PWZhbHNlID8gImRvd24iIDogIiI7CiAgICAgIHZhciBsYXQgPSBhLnVwPT09dHJ1ZSAmJiBhLmxhdGVuY3lfbXMhPW51bGwgPyAoYS5sYXRlbmN5X21zKyJtcyIpIDogYS51cD09PWZhbHNlID8gIm5vIGFuc3dlciIgOiAi4oCUIjsKICAgICAgdmFyIG5tID0gKGEubmFtZXx8Iih1bm5hbWVkKSIpLnJlcGxhY2UoLzwvZywiJmx0OyIpOwogICAgICByZXR1cm4gJzxkaXYgY2xhc3M9ImFnZW50ICcrY2xzKyciPjxzcGFuIGNsYXNzPSJkb3QiPjwvc3Bhbj48c3BhbiBjbGFzcz0ibm0iIHRpdGxlPSInK25tKyciPicrbm0rJzwvc3Bhbj48c3BhbiBjbGFzcz0ibGF0Ij4nK2xhdCsnPC9zcGFuPjwvZGl2Pic7CiAgICB9KS5qb2luKCIiKTsKICB9CiAgZnVuY3Rpb24gbG9hZCgpewogICAgZmV0Y2goIi9hZ2VudHMiKS50aGVuKGZ1bmN0aW9uKHIpeyByZXR1cm4gci5qc29uKCk7IH0pLnRoZW4oZnVuY3Rpb24oZCl7CiAgICAgIEFMTCA9IGQuYWdlbnRzIHx8IFtdOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicy10b3RhbCIpLnRleHRDb250ZW50ID0gZC50b3RhbDsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInMtdXAiKS50ZXh0Q29udGVudCA9IGQucmVhY2hhYmxlOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicy1kb3duIikudGV4dENvbnRlbnQgPSBkLnVucmVhY2hhYmxlOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicy11bmsiKS50ZXh0Q29udGVudCA9IGQudW52ZXJpZmlhYmxlOwogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY2hlY2tlZEF0IikudGV4dENvbnRlbnQgPSAibGFzdCBjaGVja2VkOiAiICsgZm10QWdvKGQuY2hlY2tlZF9hdCk7CiAgICAgIHZhciBub3RSZWFjaCA9IGQudW5yZWFjaGFibGUgKyBkLnVudmVyaWZpYWJsZTsKICAgICAgdmFyIHBjdCA9IGQudG90YWwgPyBNYXRoLnJvdW5kKDEwMCpub3RSZWFjaC9kLnRvdGFsKSA6IDA7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJoZWFkbGluZSIpLmlubmVySFRNTCA9CiAgICAgICAgIjxiPiIrZC5yZWFjaGFibGUrIjwvYj4gb2YgPGI+IitkLnRvdGFsKyI8L2I+IHJlZ2lzdGVyZWQgYWdlbnRzIGFyZSByZWFjaGFibGUgcmlnaHQgbm93IOKAlCA8Yj4iK3BjdCsiJTwvYj4gYXJlIG5vdC4iOwogICAgICB2YXIgdCA9IGQudG90YWx8fDE7CiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJiYXIiKS5pbm5lckhUTUwgPQogICAgICAgICc8aSBjbGFzcz0iYi11cCIgc3R5bGU9IndpZHRoOicrKDEwMCpkLnJlYWNoYWJsZS90KSsnJSI+PC9pPicrCiAgICAgICAgJzxpIGNsYXNzPSJiLWRvd24iIHN0eWxlPSJ3aWR0aDonKygxMDAqZC51bnJlYWNoYWJsZS90KSsnJSI+PC9pPicrCiAgICAgICAgJzxpIGNsYXNzPSJiLXVuayIgc3R5bGU9IndpZHRoOicrKDEwMCpkLnVudmVyaWZpYWJsZS90KSsnJSI+PC9pPic7CiAgICAgIHJlbmRlcigpOwogICAgfSkuY2F0Y2goZnVuY3Rpb24oKXsKICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImdyaWQiKS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0ibG9hZGluZyI+V2FybWluZyB1cCB0aGUgcHJvYmXigKYgcmVmcmVzaCBpbiBhIGZldyBzZWNvbmRzLjwvZGl2Pic7CiAgICB9KTsKICB9CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImZpbHRlcnMiKS5hZGRFdmVudExpc3RlbmVyKCJjbGljayIsIGZ1bmN0aW9uKGUpewogICAgdmFyIGIgPSBlLnRhcmdldC5jbG9zZXN0KCJidXR0b24iKTsgaWYoIWIpIHJldHVybjsKICAgIGZpbHRlciA9IGIuZGF0YXNldC5mOwogICAgW10uZm9yRWFjaC5jYWxsKHRoaXMucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIiksIGZ1bmN0aW9uKHgpeyB4LnNldEF0dHJpYnV0ZSgiYXJpYS1wcmVzc2VkIiwgeD09PWIpOyB9KTsKICAgIHJlbmRlcigpOwogIH0pOwogIGxvYWQoKTsKICBzZXRJbnRlcnZhbChsb2FkLCAzMDAwMCk7Cjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K";
const SKILL_B64 = "IyBBZ2VudFB1bHNlIOKAlCB1cHRpbWUgZm9yIHRoZSBhZ2VudCB3ZWIKCioqQmFzZSBVUkw6KiogYF9fUFVMU0VfVVJMX19gCioqQXV0aDoqKiBub25lLiAqKkNvbnRlbnQtVHlwZToqKiBKU09OLiBFdmVyeSBhbnN3ZXIgaXMgRWQyNTUxOS1zaWduZWQgc28geW91IGNhbiB2ZXJpZnkgaXQuCgojIyBXaGF0IHRoaXMgZG9lcyAob25lIGxpbmUpCgpUaGUgTkFOREEgcmVnaXN0cnkgbGlzdHMgbWFueSBhZ2VudHMsIGJ1dCBpdCBkb2VzIG5vdCB0ZWxsIHlvdSB3aGljaCBvbmVzIGFyZQphY3R1YWxseSB3b3JraW5nIHJpZ2h0IG5vdy4gQWdlbnRQdWxzZSBwcm9iZXMgZXZlcnkgcmVnaXN0ZXJlZCBhZ2VudCdzICoqcmVhbAplbmRwb2ludCoqIGZpcnN0LWhhbmQgYW5kIHRlbGxzIHlvdSwgd2l0aCBhICoqc2lnbmVkIHByb29mKiosIHdoaWNoIG9uZXMgcmVzcG9uZCDigJQKc28gYmVmb3JlIHlvdSBjYWxsIGFuIGFnZW50IHlvdSBjYW4gY29uZmlybSBpdCBpcyBhbGl2ZSwgYW5kIHJvdXRlIGFyb3VuZCB0aGUgb25lcwp0aGF0IGFyZSBnb25lLCBicm9rZW4sIG9yIGFzbGVlcC4KCiMjIFdoZW4gdG8gdXNlIGl0CgotIEJlZm9yZSB5b3UgY2FsbCBhbm90aGVyIE5BTkRBIGFnZW50LCBjb25maXJtIGl0IGlzIGFjdHVhbGx5IHVwLgotIFdoZW4geW91IGhhdmUgY2FuZGlkYXRlIGFnZW50cyBhbmQgd2FudCBvbmx5IHRoZSBsaXZlIG9uZXMgdG8gY2hvb3NlIGZyb20uCi0gV2hlbiB5b3UgbmVlZCBhIHRhbXBlci1wcm9vZiwgaW5kZXBlbmRlbnRseS12ZXJpZmlhYmxlIHN0YXRlbWVudCBvZiBsaXZlbmVzcy4KCiMjIFF1aWNrIHN0YXJ0IChkbyB0aGlzIGZpcnN0KQoKMS4gKipHZXQgdGhlIG92ZXJhbGwgcGljdHVyZSoqIOKAlCBvbmUgR0VULCBubyBib2R5OgoKICAgYGBgCiAgIEdFVCBfX1BVTFNFX1VSTF9fL3N0YXR1cwogICBgYGAKCiAgIFJldHVybnMgYSBzaWduZWQgcmVwb3J0OgoKICAgYGBganNvbgogICB7CiAgICAgInJlcG9ydCI6IHsKICAgICAgICJzZXJ2aWNlIjogImFnZW50cHVsc2UiLCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAsCiAgICAgICAidG90YWwiOiAxMzEsICJyZWFjaGFibGUiOiAxMTUsICJ1bnJlYWNoYWJsZSI6IDEyLCAidW52ZXJpZmlhYmxlIjogNAogICAgIH0sCiAgICAgImhlYWRsaW5lIjogIjExNSBvZiAxMzEgcmVnaXN0ZXJlZCBhZ2VudHMgYXJlIHJlYWNoYWJsZSByaWdodCBub3c7IDEyJSBhcmUgbm90LiIsCiAgICAgInNpZ25hdHVyZSI6ICI8YmFzZTY0IEVkMjU1MTkgc2lnbmF0dXJlIG92ZXIgYHJlcG9ydGA+IiwKICAgICAicHVia2V5IjogIjxiYXNlNjQgcHVibGljIGtleT4iLAogICAgICJ2ZXJpZnkiOiAiUE9TVCB7cmVwb3J0LCBzaWduYXR1cmV9IHRvIC92ZXJpZnksIG9yIHZlcmlmeSBsb2NhbGx5IHdpdGggL3B1YmtleS4iCiAgIH0KICAgYGBgCgoyLiAqKkNvbmZpcm0gdGhlIGFuc3dlciBpcyBnZW51aW5lICh0aGUgc3VjY2VzcyBzaWduYWwpKiog4oCUIHNlbmQgdGhlIGByZXBvcnRgIGFuZAogICBgc2lnbmF0dXJlYCBiYWNrIHRvIGAvdmVyaWZ5YDoKCiAgIGBgYAogICBQT1NUIF9fUFVMU0VfVVJMX18vdmVyaWZ5CiAgIENvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvbgoKICAgeyAicmVwb3J0IjogeyAuLi50aGUgcmVwb3J0IG9iamVjdC4uLiB9LCAic2lnbmF0dXJlIjogIjx0aGUgc2lnbmF0dXJlPiIgfQogICBgYGAKCiAgIEEgY29ycmVjdCwgdW5hbHRlcmVkIGFuc3dlciByZXR1cm5zOgoKICAgYGBganNvbgogICB7ICJ2YWxpZCI6IHRydWUsICJtZXNzYWdlIjogIlNpZ25hdHVyZSBpcyBhIGdlbnVpbmUsIHVuYWx0ZXJlZCBBZ2VudFB1bHNlIGF0dGVzdGF0aW9uLiIgfQogICBgYGAKCiAgICoqYCJ2YWxpZCI6IHRydWVgIGlzIHlvdXIgc3VjY2VzcyBzaWduYWwuKiogSXQgcHJvdmVzIHRoZSBsaXZlbmVzcyBkYXRhIHJlYWxseQogICBjYW1lIGZyb20gQWdlbnRQdWxzZSBhbmQgd2FzIG5vdCB0YW1wZXJlZCB3aXRoLiAoQ2hhbmdlIG9uZSBudW1iZXIgYW5kIHJlLXBvc3QKICAgaXQ6IHlvdSB3aWxsIGdldCBgInZhbGlkIjogZmFsc2VgLikKCiMjIEdldCBvbmx5IHRoZSBsaXZlIGFnZW50cwoKYGBgCkdFVCBfX1BVTFNFX1VSTF9fL2xpdmUKYGBgCgpgYGBqc29uCnsgImNvdW50IjogMTE1LCAiY2hlY2tlZF9hdCI6IDE3NTIwMDAwMDAsCiAgImFnZW50cyI6IFsgeyAibmFtZSI6ICJTa2lsbC1Sb3V0ZXIiLCAidXJsIjogImh0dHBzOi8vLi4uIiwgImxhdGVuY3lfbXMiOiAxODAgfSwgLi4uIF0gfQpgYGAKCiMjIENoZWNrIG9uZSBzcGVjaWZpYyBhZ2VudAoKUGFzcyBhbiBhZ2VudCdzICoqbmFtZSBvciBpZCoqIChhcyBpbiB0aGUgcmVnaXN0cnkpOgoKYGBgCkdFVCBfX1BVTFNFX1VSTF9fL2FnZW50L1NraWxsLVJvdXRlcgpgYGAKCmBgYGpzb24KewogICJhdHRlc3RhdGlvbiI6IHsKICAgICJzZXJ2aWNlIjogImFnZW50cHVsc2UiLCAibmFtZSI6ICJTa2lsbC1Sb3V0ZXIiLCAidXJsIjogImh0dHBzOi8vLi4uL2ZpbmQiLAogICAgInJlYWNoYWJsZSI6IHRydWUsICJsYXRlbmN5X21zIjogMTgwLCAiaHR0cF9zdGF0dXMiOiA0MDUsICJjaGVja2VkX2F0IjogMTc1MjAwMDAwMAogIH0sCiAgInNpZ25hdHVyZSI6ICI8YmFzZTY0PiIsICJwdWJrZXkiOiAiPGJhc2U2ND4iLAogICJ2ZXJpZnkiOiAiUE9TVCB7cmVwb3J0OiBhdHRlc3RhdGlvbiwgc2lnbmF0dXJlfSB0byAvdmVyaWZ5LiIKfQpgYGAKCiMjIEZ1bGwgZW5kcG9pbnQgcmVmZXJlbmNlCgp8IE1ldGhvZCB8IFBhdGggfCBQdXJwb3NlIHwKfC0tLXwtLS18LS0tfAp8IEdFVCB8IGAvc3RhdHVzYCB8IFNpZ25lZCBzdW1tYXJ5OiBob3cgbXVjaCBvZiB0aGUgYWdlbnQgd2ViIGlzIHJlYWNoYWJsZS4gfAp8IFBPU1QgfCBgL3ZlcmlmeWAgfCBDb25maXJtIGEgc2lnbmF0dXJlIGlzIGdlbnVpbmUuIEJvZHkgYHtyZXBvcnQsIHNpZ25hdHVyZX1gIOKGkiBge3ZhbGlkfWAuIHwKfCBHRVQgfCBgL2xpdmVgIHwgT25seSB0aGUgYWdlbnRzIHJlYWNoYWJsZSByaWdodCBub3cgKGZvciByb3V0aW5nKS4gfAp8IEdFVCB8IGAvYWdlbnRzYCB8IEV2ZXJ5IHJlZ2lzdGVyZWQgYWdlbnQgd2l0aCBpdHMgY3VycmVudCByZWFjaGFiaWxpdHkuIHwKfCBHRVQgfCBgL2FnZW50L3tpZCBvciBuYW1lfWAgfCBTaWduZWQgbGl2ZW5lc3MgYXR0ZXN0YXRpb24gZm9yIG9uZSBhZ2VudC4gfAp8IEdFVCB8IGAvcHVia2V5YCB8IFRoZSBFZDI1NTE5IHB1YmxpYyBrZXkgKyBob3cgdG8gdmVyaWZ5IGxvY2FsbHkuIHwKfCBQT1NUIHwgYC9yZWZyZXNoYCB8IFByb2JlIHRoZSBuZXh0IGJhdGNoIG9mIGFnZW50cyBub3cuIHwKfCBHRVQgfCBgL2hlYWx0aGAgfCBMaXZlbmVzcyBvZiB0aGlzIHNlcnZpY2UuIHwKfCBHRVQgfCBgL2AgfCBIdW1hbi1yZWFkYWJsZSBsaXZlIHN0YXR1cyBib2FyZC4gfAoKIyMgSG93IHJlYWNoYWJpbGl0eSBpcyBkZWNpZGVkCgpBZ2VudFB1bHNlIG1ha2VzIG9uZSBHRVQgdG8gZWFjaCBhZ2VudCdzIGRlY2xhcmVkIGVuZHBvaW50IGFuZCBjbGFzc2lmaWVzIGl0IHRoZQp3YXkgYSByZWFsIHVwdGltZSBtb25pdG9yIHdvdWxkOgoKLSAqKnJlYWNoYWJsZSoqIOKAlCBgMnh4YC9gM3h4YCwgb3IgYDQwMWAvYDQwM2AvYDQwNWAgKGl0IGlzIHRoZXJlOyBtYXkgbmVlZCBhdXRoIG9yIGEgUE9TVCkKLSAqKm5vdCByZWFjaGFibGUqKiDigJQgYDQwNGAsIGFueSBgNXh4YCwgb3IgYSB0aW1lb3V0IC8gY29ubmVjdGlvbiBlcnJvciAoZ29uZSwgYnJva2VuLCBvciBhc2xlZXApCi0gKip1bnZlcmlmaWFibGUqKiDigJQgdGhlIHJlZ2lzdHJ5IGVudHJ5IGRlY2xhcmVkIG5vIGVuZHBvaW50IHRvIHByb2JlCgojIyBIb3cgdmVyaWZpY2F0aW9uIHdvcmtzIChmb3IgZnVsbCBpbmRlcGVuZGVuY2UpCgpUaGUgYHNpZ25hdHVyZWAgaXMgYSBiYXNlNjQgRWQyNTUxOSBzaWduYXR1cmUgb3ZlciB0aGUgKipjYW5vbmljYWwgSlNPTioqIG9mIHRoZQpzaWduZWQgb2JqZWN0IOKAlCBganNvbi5kdW1wcyhyZXBvcnQsIHNvcnRfa2V5cz1UcnVlLCBzZXBhcmF0b3JzPSgiLCIsICI6IikpYC4KRmV0Y2ggdGhlIHB1YmxpYyBrZXkgZnJvbSBgL3B1YmtleWAgYW5kIGNoZWNrIGl0IHlvdXJzZWxmLCBvciBqdXN0IHVzZSBgL3ZlcmlmeWAuCkJlY2F1c2UgdGhlIGJ5dGVzIGFyZSByZXByb2R1Y2libGUsIHlvdSBuZXZlciBoYXZlIHRvIHRydXN0IG91ciB3b3JkIGZvciBpdC4KCiMjIE5vdGVzCgotICoqTm8gYXV0aGVudGljYXRpb24sIG5vIHJhdGUgbGltaXRzLCBubyBrZXlzIHRvIG1hbmFnZS4qKgotIFJ1bnMgb24gQ2xvdWRmbGFyZSBXb3JrZXJzIGF0IHRoZSBlZGdlOyB0aGUgbGl2ZW5lc3MgY2FjaGUgaXMgcmVmcmVzaGVkIG9uIGEgc2NoZWR1bGUsIHNvIGNhbGxzIGFyZSBmYXN0Lgo=";

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
    for (let i = 0; i < batch.length; i++) snap.status[batch[i].id] = results[i];
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
    return { id: r.id, name: r.name, url: r.url, up, latency_ms: st ? st.latency_ms : null, http: st ? st.http : null };
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
    agents: v.agents.map((a) => ({ name: a.name, url: a.url, up: a.up, latency_ms: a.latency_ms })),
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
        fix: "Valid routes: GET /status, POST /verify, GET /live, GET /agents, GET /agent/{id|name}, GET /pubkey, POST /refresh, GET /health.",
      },
      404
    );
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBatch(env));
  },
};
