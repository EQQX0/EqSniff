-- Starter filters every account can see. Written for this product: common
-- protocols by port, not a copy of any other tool's library.
insert into filter_rules (owner_id, name, protocol, direction, port_range, source, enabled) values
  (null, 'DNS lookups',        'udp', 'both', '[53,54)',        'built_in', true),
  (null, 'Web (HTTP)',         'tcp', 'both', '[80,81)',        'built_in', true),
  (null, 'Web (HTTPS)',        'tcp', 'both', '[443,444)',      'built_in', true),
  (null, 'Time sync (NTP)',    'udp', 'both', '[123,124)',      'built_in', true),
  (null, 'Voice and video (RTP range)', 'udp', 'both', '[16384,32768)', 'built_in', true);
