# Installation Documentation

## Required Software

Program | Version | Download | Note
------- | ------- | -------- | ----
`NodeJS` | >= 16.9 | [**here**](https://nodejs.org/en/download/) | Since discordjs v14 is used, the version needs to be at least 16.9.
`Git` | Any | [**here**](https://git-scm.com/downloads) | &nbsp;
`Python` | >= 3.11 | [**here**](https://www.python.org/downloads/) | Required for Team Finder.
`uv` | Any | [**here**](https://docs.astral.sh/uv/getting-started/installation/) | Required for Team Finder.

## Optional Software
To enable step-trace for cargoship and patrol helicopter, [**GraphicsMagick**](http://www.graphicsmagick.org/download.html) needs to be downloaded.


## Clone the repository

Open a terminal (`Git Bash` / `CMD` / `Terminal` / `PowerShell` or similar) and run the following commands:

    $ git clone https://github.com/alexemanuelol/rustplusplus.git
    $ cd rustplusplus
    $ npm install

## Team Finder

To enable `/teamfinder discover`, install the Python detector from the repository root:

    $ npm run setup:team-detector

More details: [Team Finder Setup](teamfinder.md).
