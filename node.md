## upload example app

remote repo: https://github.com/obsidionlabs/app-example

```shell
git subtree split --prefix=packages/example-app -b app-example
git remote add app-example https://github.com/obsidionlabs/app-example.git
git push app-example app-example:main
```
