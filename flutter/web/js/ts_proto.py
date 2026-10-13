#!/usr/bin/env python

import os

path = os.path.abspath(os.path.join(os.getcwd(), '..', '..', '..', 'libs', 'hbb_common', 'protos'))
# message.proto lives in the client-only base crate.
base_path = os.path.abspath(os.path.join(os.getcwd(), '..', '..', '..', 'libs', 'base', 'protos'))

if os.name == 'nt':
    cmd = r'protoc --ts_proto_opt=esModuleInterop=true --ts_proto_opt=snakeToCamel=false --plugin=protoc-gen-ts_proto=.\node_modules\.bin\protoc-gen-ts_proto.cmd  -I "%s" --ts_proto_out=./src/ rendezvous.proto'%path
    print(cmd)
    os.system(cmd)
    cmd = r'protoc --ts_proto_opt=esModuleInterop=true --ts_proto_opt=snakeToCamel=false --plugin=protoc-gen-ts_proto=.\node_modules\.bin\protoc-gen-ts_proto.cmd  -I "%s" --ts_proto_out=./src/ message.proto'%base_path
    print(cmd)
    os.system(cmd)
else:
    cmd = r'protoc --ts_proto_opt=esModuleInterop=true --ts_proto_opt=snakeToCamel=false --plugin=./node_modules/.bin/protoc-gen-ts_proto -I "%s" --ts_proto_out=./src/ rendezvous.proto'%path
    print(cmd)
    os.system(cmd)
    cmd = r'protoc --ts_proto_opt=esModuleInterop=true --ts_proto_opt=snakeToCamel=false --plugin=./node_modules/.bin/protoc-gen-ts_proto -I "%s" --ts_proto_out=./src/ message.proto'%base_path
    print(cmd)
    os.system(cmd)
