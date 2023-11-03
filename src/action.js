const core = require('@actions/core');
const xpath = require('xpath');
const DOMParser = require('xmldom').DOMParser;
const fs = require('fs');
const urlExist = require('url-exist');
const {HttpClient} = require('@actions/http-client');

const client = new HttpClient('nextcloud-version-matrix')

function versionHashBranch(version) {
    return urlExist(`https://github.com/nextcloud/server/tree/stable${version}`);
}

async function getBranch(version) {
    if (await versionHashBranch(version)) {
        return `stable${version}`;
    } else {
        return "master";
    }
}

function range(from, to) {
    return [...Array(to - from + 1).keys()].map(i => i + from);
}

async function getSupportedVersions(branch) {
    let res = await client.get(`https://raw.githubusercontent.com/nextcloud/server/${branch}/lib/versioncheck.php`);
    let versionCheckCode = await res.readBody();
    let min = parseVersionId(versionCheckCode.match(/PHP_VERSION_ID < (\d+)/)[1]);
    let max = parseVersionId(versionCheckCode.match(/PHP_VERSION_ID >= (\d+)/)[1]);
    return {min: min, max: max};
}

function parseVersionId(raw) {
    let matches = raw.match(/^(\d\d)(\d)/)
    return parseInt(matches[1], 10) / 10 + parseInt(matches[2], 10) / 10
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

        console.log(`App supports from ${minVersion} till ${maxVersion}`);

        const versions = range(minVersion, maxVersion);

        const matrix = await Promise.all(versions.map(async (version) => {
            const branch = await getBranch(version);
            const php = await getSupportedVersions(branch);
            return {
                "php-versions": php.min.toFixed(1),
                "server-versions": branch,
            }
        }));

        core.setOutput("versions", JSON.stringify(versions));

        const branches = matrix.map(matrix => matrix["server-versions"]).filter(onlyUnique);

        core.setOutput("branches", JSON.stringify(branches));
        core.setOutput("ocp-branches", JSON.stringify(branches.map(branch => `dev-${branch}`)));
        core.setOutput("matrix", JSON.stringify({
            include: matrix
        }));

    } catch (error) {
        core.setFailed(error.message);
    }
})()
