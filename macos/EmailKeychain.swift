import Foundation
import Security

let service = "com.anonchihaya.ubc-assignment-manager.email"
let account = "smtp"
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]
let action = CommandLine.arguments.dropFirst().first ?? ""
var status: OSStatus = errSecParam

switch action {
case "write":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty else { exit(1) }
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: secret] as CFDictionary)
    if status == errSecItemNotFound {
        var addition = query
        addition[kSecValueData as String] = secret
        status = SecItemAdd(addition as CFDictionary, nil)
    }
case "read":
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data {
        FileHandle.standardOutput.write(data)
    }
case "delete":
    status = SecItemDelete(query as CFDictionary)
    if status == errSecItemNotFound { status = errSecSuccess }
default:
    status = errSecParam
}

if status == errSecItemNotFound { exit(2) }
if status != errSecSuccess { exit(1) }
