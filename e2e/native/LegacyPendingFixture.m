#import <UIKit/UIKit.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>

// Non-shipping fixture app. It only seeds or verifies one synthetic legacy
// Keychain entry; it never invokes a Cycle Pair screen or application function.
@interface LegacyPendingFixture : UIResponder <UIApplicationDelegate>
@end

@implementation LegacyPendingFixture
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)options {
  NSMutableDictionary *result = [@{@"passed": @NO} mutableCopy];
  @try {
    NSString *file = [[NSBundle mainBundle] pathForResource:@"fixture" ofType:@"json"];
    NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:
        [NSData dataWithContentsOfFile:file] options:0 error:nil];
    NSString *service = fixture[@"service"];
    NSString *username = fixture[@"username"];
    NSString *password = fixture[@"password"];
    NSString *operation = fixture[@"operation"];
    NSDictionary *pending = [NSJSONSerialization JSONObjectWithData:
        [password dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *createdAt = pending[@"createdAt"];
    NSRegularExpression *timestamp = [NSRegularExpression regularExpressionWithPattern:
        @"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"
        options:0 error:nil];
    BOOL valid = [fixture[@"app"] isEqual:@"cycle-pair"] &&
        [fixture[@"syntheticOnly"] isEqual:@YES] &&
        [fixture[@"deviceId"] isEqual:
            [NSProcessInfo processInfo].environment[@"SIMULATOR_UDID"]] &&
        [service hasPrefix:@"com.seorilabs.cyclepair.offline.v1."] &&
        [username length] > 0 && [password length] > 0 &&
        [pending[@"type"] isEqual:@"daily-log"] &&
        [pending[@"uid"] isEqual:username] && [createdAt isKindOfClass:NSString.class] &&
        [timestamp numberOfMatchesInString:createdAt options:0
            range:NSMakeRange(0, createdAt.length)] == 1 &&
        ([operation isEqual:@"seed"] || [operation isEqual:@"verify-removed"]);
    if (!valid) @throw [NSException exceptionWithName:@"FixtureRejected"
        reason:@"Invalid owned synthetic fixture" userInfo:nil];
    NSData *bytes = [password dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes.bytes, (CC_LONG)bytes.length, digest);
    NSMutableString *fingerprint = [NSMutableString string];
    for (NSUInteger index = 0; index < sizeof(digest); index++)
      [fingerprint appendFormat:@"%02x", digest[index]];
    result[@"payloadSha256"] = fingerprint;
    NSMutableDictionary *query = [@{
      (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrAccessGroup: @"HCDUXX4Z3X.com.seorilabs.cyclepair",
      (__bridge id)kSecAttrService: service,
      (__bridge id)kSecAttrSynchronizable: @YES,
      (__bridge id)kSecReturnData: @YES,
      (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
    } mutableCopy];
    OSStatus legacy = SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL);
    query[(__bridge id)kSecAttrSynchronizable] = @NO;
    OSStatus local = SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL);
    // Never replace an existing queue entry or any existing application data.
    if (legacy != errSecItemNotFound || local != errSecItemNotFound)
      @throw [NSException exceptionWithName:@"FixtureRejected"
          reason:@"Fixture entry is already present or inaccessible" userInfo:nil];
    if ([operation isEqual:@"seed"]) {
      NSDictionary *attributes = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrAccessGroup: @"HCDUXX4Z3X.com.seorilabs.cyclepair",
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: username,
        (__bridge id)kSecAttrSynchronizable: @YES,
        (__bridge id)kSecAttrAccessible:
            (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        (__bridge id)kSecUseDataProtectionKeychain: @YES,
        (__bridge id)kSecValueData: bytes,
      };
      OSStatus status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
      result[@"nativeStatus"] = @(status);
      if (status != errSecSuccess)
        @throw [NSException exceptionWithName:@"FixtureRejected"
            reason:@"Unable to seed the synthetic legacy entry" userInfo:nil];
      query[(__bridge id)kSecAttrSynchronizable] = @YES;
      CFTypeRef found = NULL;
      status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
      BOOL equal = status == errSecSuccess &&
          [(__bridge NSData *)found isEqualToData:bytes];
      if (found) CFRelease(found);
      if (!equal) @throw [NSException exceptionWithName:@"FixtureRejected"
          reason:@"Legacy byte readback failed" userInfo:nil];
      result[@"seededCount"] = @1;
      result[@"legacyByteReadbackMatches"] = @YES;
    } else {
      result[@"legacyEntryAbsent"] = @YES;
      result[@"deviceOnlyQueueEntryAbsent"] = @YES;
    }
    result[@"operation"] = operation;
    result[@"passed"] = @YES;
  } @catch (NSException *exception) {
    // Reasons above are fixed text; never serialize the fixture or Keychain data.
    result[@"failure"] = exception.reason ?: @"Native fixture failed";
  }
  NSString *documents = NSSearchPathForDirectoriesInDomains(
      NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil]
      writeToFile:[documents stringByAppendingPathComponent:@"result.json"]
      atomically:YES];
  dispatch_async(dispatch_get_main_queue(), ^{ exit(0); });
  return YES;
}
@end

int main(int argc, char *argv[]) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil,
        NSStringFromClass([LegacyPendingFixture class]));
  }
}
