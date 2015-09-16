+++
date = "2015-03-17T15:36:56Z"
title = "Installation Guide"
[menu.main]
  parent = "Getting Started"
  identifier = "Installation Guide"
  weight = 1
  pre = "<i class='fa'></i>"
+++

# Installation

The recommended way to get started using the Node.js 2.0 driver is by using the `NPM` (Node Package Manager) to install the dependency in your project.

## MongoDB Driver

Given that you have created your own project using `npm init` we install the mongodb driver and it's dependencies by executing the following `NPM` command.

```
npm install mongodb --save
```

This will download the MongoDB driver and add a dependency entry in your `package.json` file.

## Troubleshooting

The MongoDB driver depends on several other packages. These are.

* mongodb-core
* bson
* kerberos

The `kerberos` package is a C++ extension that requires a build environment to be installed on your system. You must be able to build node.js itself to be able to compile and install the `kerberos` module. Furthermore the `kerberos` module requires the MIT Kerberos package to correctly compile on UNIX operating systems. Consult your UNIX operation system package manager what libraries to install.

{{% note class="important" %}}
Windows already contains the SSPI API used for Kerberos authentication. However you will need to install a full compiler tool chain using visual studio C++ to correctly install the kerberos extension.
{{% /note %}}


### Diagnosing on UNIX

If you don’t have the build essentials it won’t build. In the case of linux you will need gcc and g++, node.js with all the headers and python. The easiest way to figure out what’s missing is by trying to build the js-bson project. You can do this by performing the following steps.

```
git clone https://github.com/mongodb/js-bson.git
cd js-bson
npm install
make test
```

If all the steps complete you have the right toolchain installed. If you get node-gyp not found you need to install it globally by doing.

```
npm install -g node-gyp
```

If correctly compile and runs the tests you are golden. We can now try to install the mongod driver by performing the following command.

```
cd yourproject
npm install mongodb --save
```

If it still fails the next step is to examine the npm log. Rerun the command but in this case in verbose mode.

```
npm --loglevel verbose install mongodb
```

This will print out all the steps npm is performing while trying to install the module.

### Diagnosing on Windows

A known compiler tool chain known to work for compiling `kerberos` on windows is the following.

* Visual Studio c++ 2010 (do not use higher versions)
* Windows 7 64bit SDK
* Python 2.7 or higher

Open visual studio command prompt. Ensure node.exe is in your path and install node-gyp.

```
npm install -g node-gyp
```

Next you will have to build the project manually to test it. Use any tool you use with git and grab the repo.

```
git clone https://github.com/mongodb/js-bson.git
cd js-bson
npm install
node-gyp rebuild
```

This should rebuild the driver successfully if you have everything set up correctly.

### Other possible issues

Your python installation might be hosed making gyp break. I always recommend that you test your deployment environment first by trying to build node itself on the server in question as this should unearth any issues with broken packages (and there are a lot of broken packages out there).

Another thing is to ensure your user has write permission to wherever the node modules are being installed.
