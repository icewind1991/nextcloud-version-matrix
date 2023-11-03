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
    // yes, this is hacky, but it saves having to keep a list updated
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

async function getAllPhpVersions() {
    // again hacky, but gives a nicely always-up-to-date list
    let res = await client.get(`https://www.php.net/releases/`);
    let releasesHtml = await res.readBody();
    let matches = [...releasesHtml.matchAll(/<h2>(\d+\.\d+\.\d+)<\/h2>/g)];
    return matches.map(match => match[1]);
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

        const versionData= await Promise.all(versions.map(async (version) => {
            const branch = await getBranch(version);
            const php = await getSupportedVersions(branch);
            return {
                "phpMin": php.min,
                "phpMax": php.max,
                "branch": branch,
            }
        }));
        // parseFloat will ignore patch versions, leaving us with all major and minor releases
        const possiblePhpVersions = (await getAllPhpVersions()).map(parseFloat).filter(onlyUnique);

        const matrix = versionData.map(data => ({
            "php-versions": data.phpMin.toFixed(1),
            "server-versions": data.branch,
        }));

        core.setOutput("versions", JSON.stringify(versions));

        const branches = versionData.map(data => data.branch).filter(onlyUnique);

        const phpMin = Math.min(...versionData.map(data => data.phpMin));
        const phpMax = Math.max(...versionData.map(data => data.phpMax));

        console.log(`App supports from php ${phpMin.toFixed(1)} till php ${phpMax.toFixed(1)}`);

        const php = [];
        for(let version = phpMin; version <= phpMax; version += 0.1) {
            // floats are a pain
            version = parseFloat(version.toFixed(1));
            if (possiblePhpVersions.includes(version)) {
                php.push(version.toFixed(1));
            }
        }

        core.setOutput("branches", JSON.stringify(branches));
        core.setOutput("ocp-branches", JSON.stringify(branches.map(branch => `dev-${branch}`)));
        core.setOutput("php-versions", JSON.stringify(php));
        core.setOutput("php-min", JSON.stringify([phpMin]));
        core.setOutput("php-max", JSON.stringify([phpMax]));
        core.setOutput("branches-min", JSON.stringify([branches[0]]));
        core.setOutput("branches-max", JSON.stringify([branches.pop()]));
        core.setOutput("matrix", JSON.stringify({
            include: matrix
        }));

    } catch (error) {
        core.setFailed(error.message);
    }
})()
