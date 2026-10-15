#!/bin/sh
# Cloudflare Pages build: publish only the Christmas pages and images.
rm -rf dist && mkdir dist
cp christmas-booking.html christmas-admin.html dist/
cp dist/christmas-booking.html dist/index.html
mkdir dist/images
cp images/christmas-*.jpg images/zako-studio-logo-trim.png dist/images/
