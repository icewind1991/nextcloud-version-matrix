const core = require('@actions/core');
const xpath = require('xpath');
const DOMParser = require('xmldom').DOMParser;
const fs = require('fs');
const urlExist = require('url-exist');

function isVersionReleased(version) {
    return urlExist(`https://download.nextcloud.com/server/releases/latest-${version}.zip`);
}

function range(from, to) {
    return [...Array(to - from + 1).keys()].map(i => i + from);
}

function onlyUnique(value, index, array) {
    return array.indexOf(value) === index;
}

(async () => {
    try {
        const filename = core.getInput('filename') || 'appinfo/info.xml';

        const content = fs.readFileSync(filename, 'utf8');
        const document = new DOMParser().parseFromString(content);
        const minVersion = parseInt(xpath.select1("//info//dependencies//nextcloud/@min-version", document).value, 10);
        const maxVersion = parseInt(xpath.select1("//info//dependencies//nextcloud/@max-version", document).value, 10);

        const versions = range(minVersion, maxVersion);
        core.setOutput("versions", JSON.stringify(versions));

        const branches = await Promise.all(versions.map(async (version) => {
            if (await isVersionReleased(version)) {
                return `stable${version}`;
            } else {
                return "master";
            }
        }));

        core.setOutput("branches", JSON.stringify(branches.filter(onlyUnique)));

    } catch (error) {
        core.setFailed(error.message);
    }
})()
