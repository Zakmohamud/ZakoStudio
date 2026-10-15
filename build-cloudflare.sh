#!/bin/sh
# Cloudflare Pages build: publish only the Christmas pages and images.
rm -rf dist && mkdir dist
cp christmas-booking.html christmas-admin.html dist/
cp dist/christmas-booking.html dist/index.html
cp -r images dist/images
