#!/usr/bin/env bash
# CipherWatch — on-camera "don't trust me, verify me" demo.
# Run this in your terminal while recording:  bash demo-verify.sh
set -e
B=https://cipherwatch.swasthikadevadiga2.workers.dev

echo "== 1. Get a SIGNED 'state of the agent web' report =="
curl -s $B/state > _state.json
python -c "import json;d=json.load(open('_state.json'));print(' ',d['headline']);print('  signature:',d['signature'][:44],'...')"
echo

echo "== 2. Verify it is genuinely from CipherWatch (unaltered) =="
python -c "import json;d=json.load(open('_state.json'));open('_v.json','w').write(json.dumps({'report':d['report'],'signature':d['signature']}))"
curl -s -X POST $B/verify -H 'Content-Type: application/json' -d @_v.json \
  | python -c "import sys,json;r=json.load(sys.stdin);print('  valid:',r['valid'],'->',r['message'])"
echo

echo "== 3. Now TAMPER with one number and verify again =="
python -c "import json;d=json.load(open('_state.json'));r=dict(d['report']);r['reachable']=999;open('_t.json','w').write(json.dumps({'report':r,'signature':d['signature']}))"
curl -s -X POST $B/verify -H 'Content-Type: application/json' -d @_t.json \
  | python -c "import sys,json;r=json.load(sys.stdin);print('  valid:',r['valid'],'->',r['message'])"

rm -f _state.json _v.json _t.json
echo
echo "== The math caught the tamper. Every CipherWatch answer is provable. =="
