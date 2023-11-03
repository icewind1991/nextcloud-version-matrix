# Nextcloud version matrix action

Get a version matrix of server versions to test the app against

## Inputs

### `filename`
**Optional** The path to the `info.xml` for the app, defaults to `appinfo/info.xml`.

## Outputs

### `matrix`

Test matrix with server branch and php version

### `versions`

List of supported nextcloud versions

### `branches`

List of branches for the supported nextcloud versions

### `ocp-branches`

List of branches for the supported nextcloud/ocp versions

### `php-versions`

List of supported php versions

### `php-max`

Maximum supported php version

### `php-min`

Minimum supported php version

### `php-max-list`

Maximum supported php version, as a single-item list

### `php-min-list`

Minimum supported php version, as a single-item list

### `branches-max`

Maximum supported server version

### `branches-min`

Minimum supported server version

### `branches-max-list`

Maximum supported server version, as a single-item list

### `branches-min-list`

Minimum supported server version, as a single-item list

## License
[MIT License](LICENSE.md)
