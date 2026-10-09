import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common.dart';

void main() {
  test('an imported server config drops its relay server', () {
    final config = ServerConfig.decode(
        '{"host":"id.example.com","relay":"relay.example.com","api":"https://id.example.com","key":"k"}');
    expect(config.idServer, 'id.example.com');
    expect(config.apiServer, 'https://id.example.com');
    expect(config.key, 'k');
    expect(config.relayServer, '');
  });

  test('an encoded config round-trips without a relay server', () {
    final encoded = ServerConfig(
            idServer: 'id.example.com',
            apiServer: 'https://id.example.com',
            key: 'k')
        .encode();
    final config = ServerConfig.decode(encoded);
    expect(config.idServer, 'id.example.com');
    expect(config.relayServer, '');
  });

  test('a stored relay-server option is not loaded', () {
    final config = ServerConfig.fromOptions({
      'custom-rendezvous-server': 'id.example.com',
      'relay-server': 'relay.example.com',
    });
    expect(config.idServer, 'id.example.com');
    expect(config.relayServer, '');
  });
}
