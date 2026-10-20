<?php
/**
 * QR Code Designer for YOURLS: server side.
 *
 * The server only looks up the short URL and hands a JSON config to the browser.
 * Nothing is stored on the server, so the page needs no nonce: every request is read only.
 */

namespace WaterproofWebWizard\QrCodeDesigner;

if ( !defined( 'YOURLS_ABSPATH' ) ) {
    die();
}

const DOT_TYPES           = [ 'square', 'rounded', 'extra-rounded', 'dots', 'classy', 'classy-rounded' ];
const CORNER_SQUARE_TYPES = [ 'square', 'rounded', 'extra-rounded', 'dot' ];
const CORNER_DOT_TYPES    = [ 'square', 'rounded', 'dot' ];
const JSON_FLAGS          = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

/**
 * Load translations and register the admin page.
 */
function init(): void {
    yourls_load_custom_textdomain( DOMAIN, dirname( __DIR__ ) . '/languages' );
    yourls_register_plugin_page( PAGE, yourls__( 'QR Code Designer', DOMAIN ), __NAMESPACE__ . '\\render_page' );
}

/**
 * Add a "QR" button to every row of the admin link list.
 *
 * YOURLS prints href, title and anchor without escaping, so everything is escaped here.
 *
 * @param array<string, array<string, string>> $actions
 * @return array<string, array<string, string>>
 */
function row_action( $actions, $keyword = '' ) {
    if ( !is_array( $actions ) || !is_string( $keyword ) || $keyword === '' ) {
        return $actions;
    }
    $actions['qr'] = [
        'href'   => yourls_esc_url( page_url( $keyword ) ),
        'id'     => 'qrcd-' . md5( $keyword ),
        'title'  => yourls_esc_attr__( 'Design a QR code for this short URL', DOMAIN ),
        'anchor' => 'QR<span class="qrcd-sr"> ' . yourls_esc_html( $keyword ) . '</span>',
    ];
    return $actions;
}

/**
 * Admin URL of the designer page, optionally preloaded with a keyword.
 */
function page_url( string $keyword = '' ): string {
    $query = [ 'page' => PAGE ];
    if ( $keyword !== '' ) {
        $query['k'] = $keyword;
    }
    return yourls_admin_url( 'plugins.php?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) );
}

/**
 * Print styles and scripts, only where they are needed.
 *
 * html_head also fires on public pages such as the stats page, so the context is checked.
 */
function head( $context = '' ): void {
    if ( !yourls_is_admin() ) {
        return;
    }
    $context = is_array( $context ) ? (string) reset( $context ) : (string) $context;
    $base    = yourls_plugin_url( dirname( __DIR__ ) );

    if ( $context === 'index' || $context === 'plugin_page_' . PAGE ) {
        printf( '<link rel="stylesheet" href="%s">' . "\n", yourls_esc_url( $base . '/assets/admin.css?v=' . VERSION ) );
    }
    if ( $context === 'plugin_page_' . PAGE ) {
        foreach ( [
            '/vendor/qr-code-styling/qr-code-styling.js?v=' . LIB_VERSION,
            '/vendor/jsqr/jsQR.js?v=' . JSQR_VERSION,
            '/assets/qrcd-core.js?v=' . VERSION,
            '/assets/admin.js?v=' . VERSION,
        ] as $script ) {
            printf( '<script defer src="%s"></script>' . "\n", yourls_esc_url( $base . $script ) );
        }
    }
}

/**
 * Read the keyword from the query string, restricted to the short URL charset.
 */
function requested_keyword(): string {
    $raw = $_GET['k'] ?? '';
    return is_string( $raw ) ? yourls_sanitize_keyword( $raw, true ) : '';
}

/**
 * Safe file name stem for downloads.
 */
function file_slug( string $keyword ): string {
    $slug = trim( (string) preg_replace( '/[^A-Za-z0-9_-]+/', '-', $keyword ), '-' );
    return $slug === '' ? 'qr-code' : 'qr-' . substr( $slug, 0, 60 );
}

/**
 * Built-in style presets. Extend or replace them with the filter "qrcd_presets".
 *
 * @return array<string, array<string, mixed>>
 */
function default_presets(): array {
    return [
        'classic' => [
            'label' => yourls__( 'Classic black', DOMAIN ),
            'fg'    => '#000000', 'corner' => '#000000', 'bg' => '#ffffff',
            'dots'  => 'square', 'cornersq' => 'square', 'cornerdot' => 'square',
        ],
        'rounded' => [
            'label' => yourls__( 'Rounded', DOMAIN ),
            'fg'    => '#1f2933', 'corner' => '#1f2933', 'bg' => '#ffffff',
            'dots'  => 'rounded', 'cornersq' => 'extra-rounded', 'cornerdot' => 'dot',
        ],
        'dots'    => [
            'label' => yourls__( 'Dots', DOMAIN ),
            'fg'    => '#17191d', 'corner' => '#17191d', 'bg' => '#ffffff',
            'dots'  => 'dots', 'cornersq' => 'dot', 'cornerdot' => 'dot',
        ],
        'spaced'  => [
            'label' => yourls__( 'Spaced squares', DOMAIN ),
            'fg'    => '#000000', 'corner' => '#1f2933', 'corner2' => '#4b5563', 'bg' => '#ffffff',
            'dots'  => 'square', 'cornersq' => 'rounded', 'cornerdot' => 'rounded', 'gap' => 0.2,
        ],
    ];
}

/**
 * Validate presets coming from the filter. Invalid entries are dropped, invalid fields fall back.
 *
 * @param mixed $presets
 * @return array<string, array<string, mixed>>
 */
function sanitize_presets( $presets ): array {
    if ( !is_array( $presets ) ) {
        return [];
    }
    $clean = [];
    foreach ( $presets as $id => $p ) {
        if ( !is_array( $p ) || !preg_match( '/^[a-z0-9_-]{1,40}$/', (string) $id ) ) {
            continue;
        }
        $fg = hex_or( $p['fg'] ?? null, '#000000' );
        $clean[ (string) $id ] = [
            'label'      => isset( $p['label'] ) && is_string( $p['label'] ) && $p['label'] !== '' ? $p['label'] : (string) $id,
            'fg'         => $fg,
            'fg2'        => hex_or( $p['fg2'] ?? null, '' ),
            'corner'     => hex_or( $p['corner'] ?? null, $fg ),
            'corner2'    => hex_or( $p['corner2'] ?? null, '' ),
            'bg'         => hex_or( $p['bg'] ?? null, '#ffffff' ),
            'dots'       => enum_or( $p['dots'] ?? null, DOT_TYPES ),
            'cornersq'   => enum_or( $p['cornersq'] ?? null, CORNER_SQUARE_TYPES ),
            'cornerdot'  => enum_or( $p['cornerdot'] ?? null, CORNER_DOT_TYPES ),
            'gap'        => number_in( $p['gap'] ?? 0, 0, 0.3 ),
            'logo'       => logo_url( $p['logo'] ?? '' ),
            'logosize'   => number_in( $p['logosize'] ?? 0.3, 0.1, 0.4 ),
            'logomargin' => (int) number_in( $p['logomargin'] ?? 1, 0, 3 ),
        ];
    }
    return $clean;
}

/**
 * @param mixed $value
 */
function hex_or( $value, string $fallback ): string {
    return is_string( $value ) && preg_match( '/^#[0-9a-f]{6}$/i', $value ) ? strtolower( $value ) : $fallback;
}

/**
 * @param mixed    $value
 * @param string[] $allowed
 */
function enum_or( $value, array $allowed ): string {
    return is_string( $value ) && in_array( $value, $allowed, true ) ? $value : $allowed[0];
}

/**
 * @param mixed $value
 */
function number_in( $value, float $min, float $max ): float {
    return is_numeric( $value ) ? max( $min, min( $max, (float) $value ) ) : $min;
}

/**
 * Preset logos must be http(s) URLs. The browser fetches them, so they should live on the YOURLS domain.
 *
 * @param mixed $value
 */
function logo_url( $value ): string {
    if ( !is_string( $value ) || $value === '' ) {
        return '';
    }
    $url = yourls_esc_url( $value, 'safe', [ 'http://', 'https://' ] );
    return preg_match( '#^https?://#i', $url ) ? $url : '';
}

/**
 * Everything the browser needs, as one JSON document.
 *
 * @return array<string, mixed>
 */
function page_config( string $keyword, string $short ): array {
    return [
        'data'    => $short,
        'file'    => file_slug( $keyword ),
        'presets' => sanitize_presets( yourls_apply_filter( 'qrcd_presets', default_presets() ) ),
        'i18n'    => [
            'contrastDots'    => yourls__( 'Low contrast between dots and background. Many scanners will fail.', DOMAIN ),
            'contrastCorners' => yourls__( 'Low contrast between corner markers and background. Many scanners will fail.', DOMAIN ),
            'inverted'        => yourls__( 'Light code on a dark background (inverted) is not read by every scanner.', DOMAIN ),
            'transparent'     => yourls__( 'Transparent background: print it on a light surface only. JPG uses the background colour.', DOMAIN ),
            'logoLimited'     => yourls__( 'The logo was made smaller so the code stays readable.', DOMAIN ),
            'logoClamped'     => yourls__( 'The logo stopped at the edge of the safe area.', DOMAIN ),
            'logoNoRoom'      => yourls__( 'The logo does not fit. Make it smaller or reduce its margin.', DOMAIN ),
            'logoLoadFail'    => yourls__( 'The logo could not be loaded.', DOMAIN ),
            'logoNotSaved'    => yourls__( 'Saved as default. The logo is too large to store and was left out.', DOMAIN ),
            'empty'           => yourls__( 'No content yet: load a short URL first.', DOMAIN ),
            'saved'           => yourls__( 'Saved as default', DOMAIN ),
            'storageFail'     => yourls__( 'Your browser does not allow saving settings.', DOMAIN ),
            'copied'          => yourls__( 'PNG copied to the clipboard', DOMAIN ),
            'copyFail'        => yourls__( 'Copying failed. Use the download instead.', DOMAIN ),
            'scanRunning'     => yourls__( 'Scan test running …', DOMAIN ),
            /* translators: %s: content read from the QR code */
            'scanOk'          => yourls__( 'Scan test passed: %s', DOMAIN ),
            'scanFail'        => yourls__( 'Scan test failed: the built-in scanner cannot read this code. Increase contrast, reduce the dot gap or make the logo smaller.', DOMAIN ),
            'scanFailConfirm' => yourls__( 'The built-in scanner could not read this code. Download anyway and test it with two phones?', DOMAIN ),
            /* translators: 1: pixels, 2: dpi */
            'printPx'         => yourls__( 'Needs %1$s px at %2$s dpi. Export size set. For print, SVG is best.', DOMAIN ),
            /* translators: %s: module size in millimetres */
            'printModule'     => yourls__( 'One module (dot) measures %s mm.', DOMAIN ),
            /* translators: 1: module size in mm, 2: minimum code size in cm */
            'warnModule'      => yourls__( 'Modules of %1$s mm are too small to scan reliably. Print at least %2$s cm wide or use a shorter URL.', DOMAIN ),
            /* translators: %s: minimum size in cm */
            'warnDistance'    => yourls__( 'For this scan distance the code should be at least %s cm wide.', DOMAIN ),
            /* translators: 1: logo width in px, 2: needed width in px */
            'warnLogo'        => yourls__( 'The logo has %1$s px but needs %2$s px for this print size. Use a larger file or an SVG.', DOMAIN ),
            /* translators: %s: maximum export size in px */
            'warnMaxSize'     => yourls__( 'PNG and JPG are limited to %s px. For this print size, download the SVG.', DOMAIN ),
            'tooLong'         => yourls__( 'The content is too long for a QR code. Use a short URL.', DOMAIN ),
        ],
    ];
}

/**
 * @param array<string, string> $values value => label
 */
function options_html( array $values, string $selected = '' ): string {
    $out = '';
    foreach ( $values as $value => $label ) {
        $out .= sprintf(
            '<option value="%s"%s>%s</option>',
            yourls_esc_attr( (string) $value ),
            (string) $value === $selected ? ' selected' : '',
            yourls_esc_html( $label )
        );
    }
    return $out;
}

/**
 * Admin page.
 */
function render_page(): void {
    $keyword = requested_keyword();
    $info    = $keyword !== '' ? yourls_get_keyword_infos( $keyword ) : false;
    $short   = $info ? yourls_link( $keyword ) : '';
    $title   = is_array( $info ) && !empty( $info['title'] ) ? (string) $info['title'] : '';
    $json    = (string) json_encode( page_config( $keyword, $short ), JSON_FLAGS );

    $square  = yourls__( 'square', DOMAIN );
    $rounded = yourls__( 'rounded', DOMAIN );
    $circle  = yourls__( 'circle', DOMAIN );
    ?>
    <main id="qrcd" class="qrcd">
        <h2><?php yourls_esc_html_e( 'QR Code Designer', DOMAIN ); ?></h2>

        <form method="get" class="qrcd-load">
            <input type="hidden" name="page" value="<?php echo yourls_esc_attr( PAGE ); ?>">
            <label for="qrcd-k"><?php yourls_esc_html_e( 'Short URL keyword', DOMAIN ); ?></label>
            <input type="text" id="qrcd-k" name="k" class="text" value="<?php echo yourls_esc_attr( $keyword ); ?>" autocomplete="off">
            <button type="submit" class="button"><?php yourls_esc_html_e( 'Load', DOMAIN ); ?></button>
            <span class="qrcd-hint"><?php yourls_esc_html_e( 'or click "QR" in the link list.', DOMAIN ); ?></span>
        </form>

        <?php if ( $keyword !== '' && !$info ) : ?>
            <p class="qrcd-error" role="alert"><?php yourls_esc_html_e( 'No short URL found with this keyword.', DOMAIN ); ?></p>
        <?php endif; ?>

        <div class="qrcd-grid">
            <div class="qrcd-controls">
                <p>
                    <label for="qrcd-data"><?php yourls_esc_html_e( 'QR code content', DOMAIN ); ?></label>
                    <input type="url" id="qrcd-data" class="text qrcd-wide" value="<?php echo yourls_esc_attr( $short ); ?>" spellcheck="false">
                    <?php if ( $title !== '' ) : ?><small class="qrcd-title"><?php echo yourls_esc_html( $title ); ?></small><?php endif; ?>
                </p>

                <p class="qrcd-row">
                    <label for="qrcd-preset"><?php yourls_esc_html_e( 'Preset', DOMAIN ); ?></label>
                    <select id="qrcd-preset"><option value=""><?php yourls_esc_html_e( 'custom', DOMAIN ); ?></option></select>
                    <button type="button" class="button" id="qrcd-save"><?php yourls_esc_html_e( 'Save as default', DOMAIN ); ?></button>
                    <button type="button" class="button" id="qrcd-reset"><?php yourls_esc_html_e( 'Reset', DOMAIN ); ?></button>
                </p>

                <fieldset>
                    <legend><?php yourls_esc_html_e( 'Colours', DOMAIN ); ?></legend>
                    <div class="qrcd-line">
                        <label><?php yourls_esc_html_e( 'Dots', DOMAIN ); ?> <input type="color" id="qrcd-fg" value="#000000"></label>
                        <label><input type="checkbox" id="qrcd-fggrad"> <?php yourls_esc_html_e( 'gradient to', DOMAIN ); ?></label>
                        <input type="color" id="qrcd-fg2" value="#555555" aria-label="<?php yourls_esc_attr_e( 'Second dot colour', DOMAIN ); ?>">
                    </div>
                    <div class="qrcd-line">
                        <label><?php yourls_esc_html_e( 'Corners', DOMAIN ); ?> <input type="color" id="qrcd-corner" value="#000000"></label>
                        <label><input type="checkbox" id="qrcd-cornergrad"> <?php yourls_esc_html_e( 'gradient to', DOMAIN ); ?></label>
                        <input type="color" id="qrcd-corner2" value="#555555" aria-label="<?php yourls_esc_attr_e( 'Second corner colour', DOMAIN ); ?>">
                    </div>
                    <div class="qrcd-line">
                        <label><?php yourls_esc_html_e( 'Background', DOMAIN ); ?> <input type="color" id="qrcd-bg" value="#ffffff"></label>
                        <label><input type="checkbox" id="qrcd-transparent"> <?php yourls_esc_html_e( 'transparent', DOMAIN ); ?></label>
                    </div>
                </fieldset>

                <fieldset>
                    <legend><?php yourls_esc_html_e( 'Shape', DOMAIN ); ?></legend>
                    <label><?php yourls_esc_html_e( 'Dots', DOMAIN ); ?> <select id="qrcd-dots"><?php echo options_html( [
                        'square'         => $square,
                        'rounded'        => $rounded,
                        'extra-rounded'  => yourls__( 'extra rounded', DOMAIN ),
                        'dots'           => yourls__( 'circles', DOMAIN ),
                        'classy'         => yourls__( 'classy', DOMAIN ),
                        'classy-rounded' => yourls__( 'classy rounded', DOMAIN ),
                    ] ); ?></select></label>
                    <label><?php yourls_esc_html_e( 'Corner frame', DOMAIN ); ?> <select id="qrcd-cornersq"><?php echo options_html( [
                        'square'        => $square,
                        'rounded'       => yourls__( 'slightly rounded', DOMAIN ),
                        'extra-rounded' => $rounded,
                        'dot'           => $circle,
                    ] ); ?></select></label>
                    <label><?php yourls_esc_html_e( 'Corner dot', DOMAIN ); ?> <select id="qrcd-cornerdot"><?php echo options_html( [
                        'square'  => $square,
                        'rounded' => yourls__( 'slightly rounded', DOMAIN ),
                        'dot'     => $circle,
                    ] ); ?></select></label>
                    <label><?php yourls_esc_html_e( 'Dot gap', DOMAIN ); ?> <input type="range" id="qrcd-gap" min="0" max="0.3" step="0.05" value="0"> <output id="qrcd-gap-out" for="qrcd-gap">0 %</output></label>
                </fieldset>

                <fieldset>
                    <legend><?php yourls_esc_html_e( 'Logo (optional, never leaves your browser)', DOMAIN ); ?></legend>
                    <div class="qrcd-line">
                        <input type="file" id="qrcd-logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label="<?php yourls_esc_attr_e( 'Choose logo', DOMAIN ); ?>">
                        <button type="button" class="button" id="qrcd-logo-del"><?php yourls_esc_html_e( 'Remove logo', DOMAIN ); ?></button>
                    </div>
                    <label><?php yourls_esc_html_e( 'Logo size', DOMAIN ); ?> <input type="range" id="qrcd-logosize" min="0.1" max="0.4" step="0.02" value="0.3"> <output id="qrcd-logosize-out" for="qrcd-logosize">30 %</output></label>
                    <label><?php yourls_esc_html_e( 'Free space around the logo', DOMAIN ); ?> <select id="qrcd-logomargin"><?php echo options_html( [
                        '0' => yourls__( 'none', DOMAIN ),
                        '1' => yourls__( '1 module', DOMAIN ),
                        '2' => yourls__( '2 modules', DOMAIN ),
                        '3' => yourls__( '3 modules', DOMAIN ),
                    ], '1' ); ?></select></label>
                    <label><input type="checkbox" id="qrcd-hidedots" checked> <?php yourls_esc_html_e( 'Hide dots behind the logo', DOMAIN ); ?></label>
                    <div class="qrcd-line">
                        <label><?php yourls_esc_html_e( 'Horizontal', DOMAIN ); ?> <input type="range" id="qrcd-logox" min="-100" max="100" step="5" value="0"></label>
                        <label><?php yourls_esc_html_e( 'Vertical', DOMAIN ); ?> <input type="range" id="qrcd-logoy" min="-100" max="100" step="5" value="0"></label>
                        <button type="button" class="button" id="qrcd-logo-centre"><?php yourls_esc_html_e( 'Centre', DOMAIN ); ?></button>
                    </div>
                    <small class="qrcd-hint"><?php yourls_esc_html_e( 'You can also drag the logo in the preview. It only moves within the safe area.', DOMAIN ); ?></small>
                </fieldset>

                <fieldset>
                    <legend><?php yourls_esc_html_e( 'Print', DOMAIN ); ?></legend>
                    <label><?php yourls_esc_html_e( 'Printed width', DOMAIN ); ?> <input type="number" id="qrcd-printcm" min="0.5" max="500" step="0.1" inputmode="decimal" class="qrcd-num"> cm</label>
                    <label><?php yourls_esc_html_e( 'Resolution', DOMAIN ); ?> <select id="qrcd-dpi"><?php echo options_html( [ '300' => '300 dpi', '600' => '600 dpi' ], '300' ); ?></select></label>
                    <label><?php yourls_esc_html_e( 'Scan distance (optional)', DOMAIN ); ?> <input type="number" id="qrcd-distance" min="5" max="10000" step="5" inputmode="numeric" class="qrcd-num"> cm</label>
                    <p id="qrcd-printinfo" class="qrcd-printinfo" aria-live="polite"></p>
                </fieldset>

                <fieldset>
                    <legend><?php yourls_esc_html_e( 'Output', DOMAIN ); ?></legend>
                    <label><?php yourls_esc_html_e( 'Size', DOMAIN ); ?> <input type="number" id="qrcd-size" min="200" max="6000" step="10" value="1000" class="qrcd-num"> px</label>
                    <label><?php yourls_esc_html_e( 'Quiet zone', DOMAIN ); ?> <select id="qrcd-quiet"><?php echo options_html( [
                        '0' => yourls__( 'none', DOMAIN ),
                        '2' => yourls__( '2 modules', DOMAIN ),
                        '4' => yourls__( '4 modules (standard)', DOMAIN ),
                    ], '4' ); ?></select></label>
                    <label><?php yourls_esc_html_e( 'Error correction', DOMAIN ); ?> <select id="qrcd-ecc"><?php echo options_html( [
                        'L' => yourls__( 'L (7 %)', DOMAIN ),
                        'M' => yourls__( 'M (15 %)', DOMAIN ),
                        'Q' => yourls__( 'Q (25 %)', DOMAIN ),
                        'H' => yourls__( 'H (30 %, always used with a logo)', DOMAIN ),
                    ], 'M' ); ?></select></label>
                </fieldset>

                <p class="qrcd-actions">
                    <button type="button" class="button primary" data-ext="png"><?php yourls_esc_html_e( 'Download PNG', DOMAIN ); ?></button>
                    <button type="button" class="button" data-ext="svg"><?php yourls_esc_html_e( 'Download SVG (print)', DOMAIN ); ?></button>
                    <button type="button" class="button" data-ext="jpeg"><?php yourls_esc_html_e( 'Download JPG', DOMAIN ); ?></button>
                    <button type="button" class="button" id="qrcd-copy" hidden><?php yourls_esc_html_e( 'Copy PNG', DOMAIN ); ?></button>
                </p>
                <p id="qrcd-scan" class="qrcd-scan" role="status" aria-live="polite"></p>
                <p id="qrcd-status" class="qrcd-status" role="status" aria-live="polite"></p>
            </div>

            <div class="qrcd-preview" id="qrcd-preview" role="img" aria-label="<?php yourls_esc_attr_e( 'QR code preview', DOMAIN ); ?>"></div>
        </div>

        <noscript><p class="qrcd-error"><?php yourls_esc_html_e( 'The QR code is rendered in your browser. Please enable JavaScript.', DOMAIN ); ?></p></noscript>
        <script type="application/json" id="qrcd-config"><?php echo $json; ?></script>
    </main>
    <?php
}
