#!/bin/bash

 if [ "$#" -eq  "0" ]
   then
     echo "usage: ./update.sh [version|latest]"
     exit
 fi


if [ "$1" = "latest" ]
then
  TAG=`curl --silent "https://api.github.com/repos/sui77/scann3r/releases/latest" | grep -Po '"tag_name": "\K.*?(?=")'`
  echo Checkout latest release $TAG
else
  TAG=$1
  echo Checkout $TAG
fi
git fetch

git checkout -f $TAG
if [ $? -eq 0 ]; then
    npm update
    echo "Update done."
else
    echo "Update failed."
fi

