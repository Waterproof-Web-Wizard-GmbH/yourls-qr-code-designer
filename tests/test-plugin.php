<?php
/**
 * Tests for QR Code Designer, run with the official YOURLS test suite for plugins.
 *
 * @link https://github.com/YOURLS/YOURLS-test-suite-for-plugins
 */

use WaterproofWebWizard\QrCodeDesigner as Qr;

class QrCodeDesignerTest extends PHPUnit\Framework\TestCase {

    private static string $keyword = 'qrcdtest';

    public static function setUpBeforeClass(): void {
        Qr\init();
        if ( !yourls_keyword_is_taken( self::$keyword ) ) {
            // The installer has just added sample links, so skip the flood check for this fixture.
            yourls_add_filter( 'shunt_check_IP_flood', 'yourls_return_true' );
            yourls_add_new_link( 'https://example.com/landing?utm_source=qr', self::$keyword, 'QR test title' );
            yourls_remove_filter( 'shunt_check_IP_flood', 'yourls_return_true' );
        }
    }

    protected function tearDown(): void {
        unset( $_GET['k'] );
    }

    private function render( $k ): string {
        if ( $k !== null ) {
            $_GET['k'] = $k;
        }
        ob_start();
        Qr\render_page();
        return (string) ob_get_clean();
    }

    private static function config( string $html ): array {
        preg_match( '#<script type="application/json" id="qrcd-config">(.*?)</script>#s', $html, $m );
        return $m ? (array) json_decode( $m[1], true ) : [];
    }

    public function test_plugin_page_is_registered(): void {
        $pages = yourls_get_db( 'read-test' )->get_plugin_pages();
        $this->assertArrayHasKey( Qr\PAGE, $pages );
        $this->assertIsCallable( $pages[ Qr\PAGE ]['function'] );
    }

    public function test_row_action_links_to_the_designer(): void {
        $actions = yourls_apply_filter( 'table_add_row_action_array', [], 'abc' );
        $this->assertArrayHasKey( 'qr', $actions );
        $this->assertStringContainsString( 'page=' . Qr\PAGE . '&k=abc', html_entity_decode( $actions['qr']['href'] ) );
        $this->assertStringContainsString( '<span class="qrcd-sr"> abc</span>', $actions['qr']['anchor'] );
    }

    public function test_row_action_escapes_everything_core_prints_raw(): void {
        // Make the admin URL itself hostile: only our escaping stands between it and the page.
        $evil = static fn ( $url ) => $url . '"><x onmouseover=alert(1)>';
        yourls_add_filter( 'admin_url', $evil );
        $actions = Qr\row_action( [], 'k<b>"' );
        yourls_remove_filter( 'admin_url', $evil );

        $this->assertStringNotContainsString( '"', $actions['qr']['href'] );
        $this->assertStringNotContainsString( '<', $actions['qr']['href'] );
        $this->assertStringNotContainsString( '<b>', $actions['qr']['anchor'] );
        $this->assertStringContainsString( '&lt;b&gt;', $actions['qr']['anchor'] );
        $this->assertStringNotContainsString( '"', $actions['qr']['title'] );
    }

    public function test_row_action_ignores_bad_input(): void {
        $this->assertSame( 'x', Qr\row_action( 'x', 'kw' ) );
        $this->assertSame( [], Qr\row_action( [], '' ) );
    }

    public function test_file_slug(): void {
        $this->assertSame( 'qr-abc_1-x', Qr\file_slug( 'abc_1 x' ) );
        $this->assertSame( 'qr-code', Qr\file_slug( '' ) );
        $this->assertSame( 'qr-code', Qr\file_slug( '../..' ) );
        $this->assertSame( 63, strlen( Qr\file_slug( str_repeat( 'a', 200 ) ) ) );
    }

    public function test_sanitize_presets(): void {
        $clean = Qr\sanitize_presets( [
            'brand'     => [
                'label' => 'Brand', 'fg' => '#04C862', 'fg2' => 'nope', 'corner2' => '#BC0A0A', 'bg' => 'red',
                'dots'  => 'rounded', 'cornersq' => 'evil', 'cornerdot' => 'rounded',
                'gap'   => 0.9, 'logo' => 'javascript:alert(1)', 'logosize' => 'x', 'logomargin' => 7,
            ],
            'withlogo'  => [ 'logo' => 'https://sho.rt/user/logo.svg', 'gap' => '0.15' ],
            'Bad Id'    => [ 'fg' => '#000000' ],
            'not-array' => 'x',
        ] );
        $this->assertSame( [ 'brand', 'withlogo' ], array_keys( $clean ) );
        $b = $clean['brand'];
        $this->assertSame( '#04c862', $b['fg'] );
        $this->assertSame( '', $b['fg2'], 'invalid second colour means no gradient' );
        $this->assertSame( '#04c862', $b['corner'], 'corner falls back to fg' );
        $this->assertSame( '#bc0a0a', $b['corner2'] );
        $this->assertSame( '#ffffff', $b['bg'] );
        $this->assertSame( 'square', $b['cornersq'] );
        $this->assertSame( 'rounded', $b['cornerdot'] );
        $this->assertSame( 0.3, $b['gap'], 'gap is capped' );
        $this->assertSame( '', $b['logo'], 'only http(s) logos' );
        $this->assertSame( 0.1, $b['logosize'] );
        $this->assertSame( 3, $b['logomargin'] );
        $this->assertSame( 'https://sho.rt/user/logo.svg', $clean['withlogo']['logo'] );
        $this->assertSame( 0.15, $clean['withlogo']['gap'] );
        $this->assertSame( [], Qr\sanitize_presets( 'nope' ) );
    }

    public function test_presets_filter_is_applied(): void {
        $add = static function ( $p ) {
            $p['brand'] = [ 'label' => 'Brand', 'fg' => '#123456' ];
            return $p;
        };
        yourls_add_filter( 'qrcd_presets', $add );
        $cfg = Qr\page_config( 'kw', 'https://sho.rt/kw' );
        yourls_remove_filter( 'qrcd_presets', $add );
        $this->assertArrayHasKey( 'classic', $cfg['presets'] );
        $this->assertArrayHasKey( 'spaced', $cfg['presets'] );
        $this->assertSame( '#123456', $cfg['presets']['brand']['fg'] );
        $this->assertSame( 'qr-kw', $cfg['file'] );
    }

    public function test_page_preloads_known_keyword(): void {
        $html = $this->render( self::$keyword );
        $this->assertStringContainsString( yourls_link( self::$keyword ), $html );
        $this->assertStringContainsString( 'QR test title', $html );
        $this->assertSame( yourls_link( self::$keyword ), self::config( $html )['data'] );
        $this->assertStringNotContainsString( 'role="alert"', $html );
        foreach ( [ 'qrcd-logox', 'qrcd-logoy', 'qrcd-gap', 'qrcd-fggrad', 'qrcd-printcm', 'qrcd-dpi', 'qrcd-scan' ] as $id ) {
            $this->assertStringContainsString( 'id="' . $id . '"', $html );
        }
    }

    public function test_page_escapes_the_link_title(): void {
        $evil = static function ( $infos ) {
            if ( is_array( $infos ) ) {
                $infos['title'] = '<b>QR</b> "test"';
            }
            return $infos;
        };
        yourls_add_filter( 'get_keyword_infos', $evil );
        $html = $this->render( self::$keyword );
        yourls_remove_filter( 'get_keyword_infos', $evil );
        $this->assertStringContainsString( '&lt;b&gt;QR&lt;/b&gt;', $html );
        $this->assertStringNotContainsString( '<b>QR</b>', $html );
    }

    public function test_page_escapes_the_short_url(): void {
        $evil = static fn ( $link ) => $link . '"><b>x</b>';
        yourls_add_filter( 'yourls_link', $evil );
        $html = $this->render( self::$keyword );
        yourls_remove_filter( 'yourls_link', $evil );
        $this->assertStringNotContainsString( '"><b>x</b>', $html );
    }

    public function test_options_are_escaped(): void {
        $html = Qr\options_html( [ '"a' => '<b>label</b>' ], '"a' );
        $this->assertStringNotContainsString( '<b>', $html );
        $this->assertStringContainsString( '&lt;b&gt;label', $html );
        $this->assertStringContainsString( 'value="&quot;a" selected', $html );
    }

    public function test_page_reports_unknown_keyword(): void {
        $this->assertStringContainsString( 'role="alert"', $this->render( 'doesnotexist123' ) );
    }

    public function test_page_survives_array_input(): void {
        $html = $this->render( [ 'x' ] );
        $this->assertStringContainsString( 'id="qrcd"', $html );
        $this->assertSame( '', self::config( $html )['data'] );
    }

    public function test_config_json_cannot_break_out_of_script_tag(): void {
        $add = static fn ( $p ) => [ 'x' => [ 'label' => '</script><img src=x onerror=alert(1)>' ] ];
        yourls_add_filter( 'qrcd_presets', $add );
        $html = $this->render( self::$keyword );
        yourls_remove_filter( 'qrcd_presets', $add );
        $this->assertStringNotContainsString( '</script><img', $html );
        $this->assertSame( '</script><img src=x onerror=alert(1)>', self::config( $html )['presets']['x']['label'] );
    }

    public function test_config_survives_invalid_utf8(): void {
        $add = static fn ( $p ) => [ 'x' => [ 'label' => "bad \xB1 utf8" ] ];
        yourls_add_filter( 'qrcd_presets', $add );
        $cfg = self::config( $this->render( self::$keyword ) );
        yourls_remove_filter( 'qrcd_presets', $add );
        $this->assertArrayHasKey( 'x', $cfg['presets'] );
        $this->assertNotEmpty( $cfg['i18n'] );
    }

    public function test_assets_load_only_in_admin_contexts(): void {
        $capture = static function ( string $context ): string {
            ob_start();
            Qr\head( $context );
            return (string) ob_get_clean();
        };
        $this->assertSame( '', $capture( 'plugin_page_' . Qr\PAGE ), 'nothing outside the admin' );

        yourls_add_filter( 'is_admin', 'yourls_return_true' );
        $page  = $capture( 'plugin_page_' . Qr\PAGE );
        $list  = $capture( 'index' );
        $stats = $capture( 'infos' );
        yourls_remove_filter( 'is_admin', 'yourls_return_true' );

        foreach ( [ 'qr-code-styling.js', 'jsQR.js', 'qrcd-core.js', 'admin.js' ] as $script ) {
            $this->assertStringContainsString( $script, $page );
        }
        $this->assertStringContainsString( 'admin.css', $list );
        $this->assertStringNotContainsString( 'admin.js', $list );
        $this->assertSame( '', $stats );
    }

    public function test_german_translation_loads(): void {
        $de = static fn () => 'de_DE';
        yourls_add_filter( 'load_custom_textdomain', $de );
        yourls_load_custom_textdomain( Qr\DOMAIN, dirname( __DIR__ ) . '/languages' );
        yourls_remove_filter( 'load_custom_textdomain', $de );
        $this->assertSame( 'PNG herunterladen', yourls__( 'Download PNG', Qr\DOMAIN ) );
        $this->assertSame( 'Druck', yourls__( 'Print', Qr\DOMAIN ) );
        yourls_unload_textdomain( Qr\DOMAIN );
    }
}
