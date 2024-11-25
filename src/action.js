const core = require('@actions/core');
const xpath = require('xpath');
const DOMParser = require('xmldom').DOMParser;
const fs = require('fs');
const urlExist = require('url-exist');
const {HttpClient} = require('@actions/http-client');
const equal = require('deep-equal');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec)

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
    let min, max;
    if (versionCheckCode.match(/PHP_VERSION_ID < (\d+)/)) {
        min = parseVersionId(versionCheckCode.match(/PHP_VERSION_ID < (\d+)/)[1]);
        max = parseVersionId(versionCheckCode.match(/PHP_VERSION_ID >= (\d+)/)[1]);
    } else {
        min = parseFloat(versionCheckCode.match(/PHP_VERSION, '([\d.]+)'\) === -1/)[1]);
        max = parseFloat(versionCheckCode.match(/PHP_VERSION, '([\d.]+)'\) !== -1/)[1]);
    }
    max = parseFloat((max - 0.1).toFixed(1));
    return {min: min, max: max};
}

function parseVersionId(raw) {
    let matches = raw.match(/^(\d\d)(\d)/)
    return parseInt(matches[1], 10) / 10 + parseInt(matches[2], 10) / 10
}

async function isPhpVersionReleased(version) {
    return await urlExist(`https://github.com/php/php-src/releases/tag/php-${version.toFixed(1)}.0`);
}

async function distroSupportsPhpVersion(version) {
    try {
        const output = await exec(`apt-cache policy php${version}`);
        return output.stdout.includes("Candidate")
    } catch (_e) {
        return false;
    }
}

function onlyUnique(value, index, array) {
    return array.findIndex(item => equal(value, item)) === index;
}

function cartesianProduct(input) {
    const inputArray = [];
    for (let key of Object.keys(input)) {
        const item = {};
        item[key] = input[key];
        inputArray.push(item);
    }
    return cartesianProductInner(inputArray);
}

// https://stackoverflow.com/a/18959668
function cartesianProductInner(input, current) {
    if (!input || !input.length) { return []; }

    let head = input[0];
    let tail = input.slice(1);
    let output = [];

    for (let key in head) {
        for (let i = 0; i < head[key].length; i++) {
            let newCurrent = copy(current);
            newCurrent[key] = head[key][i];
            if (tail.length) {
                let productOfTail =
                    cartesianProductInner(tail, newCurrent);
                output = output.concat(productOfTail);
            } else output.push(newCurrent);
        }
    }
    return output;
}

function copy(obj) {
    let res = {};
    for (let p in obj) res[p] = obj[p];
    return res;
}


(async () => {
    try {
        const filename = core.getInput('filename') || 'appinfo/info.xml';
        const matrixInput = JSON.parse(core.getInput('matrix') || '{}');
        const withPhpInput = core.getInput('with_php') || '[]';
        console.log(withPhpInput);
        let withPhp = [];
        if (withPhpInput.startsWith('[') && withPhpInput.endsWith(']')) {
            withPhp = JSON.parse(withPhpInput);
        } else {
            withPhp = [withPhpInput];
        }

        const content = fs.readFileSync(filename, 'utf8');
        const document = new DOMParser().parseFromString(content);
        const minVersion = parseInt(xpath.select1("//info//dependencies//nextcloud/@min-version", document).value, 10);
        const maxVersion = parseInt(xpath.select1("//info//dependencies//nextcloud/@max-version", document).value, 10);

        console.log(`App supports from ${minVersion} till ${maxVersion}`);

        const versions = range(minVersion, maxVersion);

        // we reverse the order to put highest version first for the "branched off check"
        const versionData= (await Promise.all(versions.reverse().map(async (version) => {
            const branch = await getBranch(version);
            const php = await getSupportedVersions(branch);
            return {
                "phpMin": php.min,
                "phpMax": php.max,
                "branch": branch,
            }
        }))).reverse();

        // matrix with a single php version per server version
        const serverMatrix = cartesianProduct({
            "server-versions": versionData.map(data => data.branch),
            ...matrixInput
        });
        serverMatrix.forEach(row => {
            const phpMax = versionData.find(data => data.branch === row["server-versions"]).phpMax;
            row["php-versions"] = phpMax.toFixed(1);
        });
        for (let extraPhpVersion of withPhp) {
            serverMatrix.push({
                "php-versions": extraPhpVersion,
                "server-versions": "master",
            });
        }

        core.setOutput("versions", JSON.stringify(versions));

        const branches = versionData.map(data => data.branch).filter(onlyUnique);

        const phpMin = Math.min(...versionData.map(data => data.phpMin));
        const phpMax = Math.max(...versionData.map(data => data.phpMax));

        const php = withPhp.concat([]); // clone, not alias
        for(let version = phpMin; version <= phpMax; version += 0.1) {
            // floats are a pain
            version = parseFloat(version.toFixed(1));
            if (await isPhpVersionReleased(version)) {
                php.push(version.toFixed(1));
                console.log(`Release for PHP Version ${version.toFixed(1)} exists`);
            } else {
                // no more minors for this major
                version = Math.ceil(version) - 0.1;
                console.log(`No release for PHP Version ${version.toFixed(1)} exists -> skipping`);
            }
        }
        php.sort();

        const distroPhp = [];
        let availablePhp = phpMax;
        for(let version of php) {
            if (await distroSupportsPhpVersion(version)) {
                distroPhp.push(version)
                availablePhp = version;

                console.log(`Install candidates for PHP Version ${version.toFixed(1)} found`);
            } else {
                console.log(`No install candidates for PHP version ${version.toFixed(1)} found -> skipping`);
            }
        }

        // matrix with a single server version per php version
        const phpMatrix = cartesianProduct({
            "php-versions": php,
            ...matrixInput
        });
        phpMatrix.forEach(row => {
            const php = row['php-versions'];
            const candidateVersion = versionData.findLast(data => data.phpMin <= php && data.phpMax >= php);
            row["server-versions"] = candidateVersion?.branch ?? "master";
        });

        // matrix with every php and server combination
        const fullMatrix = cartesianProduct({
            "server-versions": versionData.map(data => data.branch),
            "php-versions": php,
            ...matrixInput
        }).filter(row => {
            const php = row['php-versions'];
            const version = versionData.find(version => version.branch === row['server-versions']);
            return version.phpMin <= php && version.phpMax >= php;
        });
        for (let extraPhpVersion of withPhp) {
            fullMatrix.push({
                "php-versions": extraPhpVersion,
                "server-versions": "master",
            });
        }

        // matrix with at least one item for every server and php version
        let testMatrix = phpMatrix.concat(serverMatrix).filter(onlyUnique);

        console.log(`App supports from php ${phpMin.toFixed(1)} till php ${phpMax.toFixed(1)}`);

        core.setOutput("branches", JSON.stringify(branches));
        core.setOutput("ocp-branches", JSON.stringify(branches.map(branch => `dev-${branch}`)));
        core.setOutput("php-versions", JSON.stringify(php));

        core.setOutput("php-min-list", JSON.stringify([php[0]]));
        core.setOutput("php-max-list", JSON.stringify([php[php.length - 1]]));
        core.setOutput("php-available-list", JSON.stringify([availablePhp]));
        core.setOutput("branches-min-list", JSON.stringify([branches[0]]));
        core.setOutput("branches-max-list", JSON.stringify([branches[branches.length - 1]]));

        core.setOutput("php-min", php[0]);
        core.setOutput("php-max", php[php.length - 1]);
        core.setOutput("php-available", availablePhp);
        core.setOutput("branches-min", branches[0]);
        core.setOutput("branches-max", branches[branches.length - 1]);

        core.setOutput("matrix", JSON.stringify({
            include: serverMatrix
        }));
        core.setOutput("sparse-matrix", JSON.stringify({
            include: testMatrix
        }));
        core.setOutput("full-matrix", JSON.stringify({
            include: fullMatrix
        }));

        core.setOutput("ocp-matrix", JSON.stringify({
            include: serverMatrix.map(row => {
                const ocpVersion = `dev-${row["server-versions"]}`;
                delete row["server-versions"];
                row["ocp-version"] = ocpVersion;
                return row;
            })
        }));

    } catch (error) {
        core.setFailed(error.message);
    }
})()
