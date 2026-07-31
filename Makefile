
cat-config:
	@base64 -D -i ~/.fool-config-dev/fool-config.txt | python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read()))' | pbcopy
