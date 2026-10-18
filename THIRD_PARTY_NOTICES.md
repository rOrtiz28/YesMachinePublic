# Third-party notices

Yes Machine is free software under the [MIT license](LICENSE). It is built on the third-party software below, each under its own license. Every license here lets Yes Machine be used, changed and shared freely, as long as these notices go with it. The desktop app and the Android app carry this file.

## The desktop app

The desktop app runs on [Electron](https://www.electronjs.org) 44.5.1 (MIT), which includes Chromium and Node.js. Their licenses come with every build of the app, as `LICENSE.electron.txt` and `LICENSES.chromium.html`: beside the program on Windows and Linux, and in `Contents/Resources` on a Mac.

The packages it uses, each with its own license file inside the app (in `node_modules`):

| Package | Version | License |
| --- | --- | --- |
| [@jitsi/robotjs](https://github.com/jitsi/robotjs) | 0.6.24 | MIT |
| [@leichtgewicht/ip-codec](https://github.com/martinheidegger/ip-codec#readme) | 2.0.5 | MIT |
| [@noble/hashes](https://paulmillr.com/noble/) | 1.8.0 | MIT |
| [@peculiar/asn1-cms](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/cms#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-csr](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/csr#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-ecc](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/ecc#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-pfx](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/pfx#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-pkcs8](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/pkcs8#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-pkcs9](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/pkcs9#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-rsa](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/rsa#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-schema](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/schema#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-x509](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/x509#readme) | 2.10.0 | MIT |
| [@peculiar/asn1-x509-attr](https://github.com/PeculiarVentures/asn1-schema/tree/master/packages/x509-attr#readme) | 2.10.0 | MIT |
| [@peculiar/utils](https://github.com/PeculiarVentures/pvtsutils#readme) | 2.0.3 | MIT |
| [@peculiar/x509](https://github.com/PeculiarVentures/x509#readme) | 1.14.3 | MIT |
| [asn1js](https://github.com/PeculiarVentures/ASN1.js) | 3.0.10 | BSD-3-Clause |
| [bonjour-service](https://github.com/onlxltd/bonjour-service) | 1.4.4 | MIT |
| [bytestreamjs](https://github.com/PeculiarVentures/ByteStream.js) | 2.0.1 | BSD-3-Clause |
| [dns-packet](https://github.com/mafintosh/dns-packet) | 5.6.1 | MIT |
| [fast-deep-equal](https://github.com/epoberezkin/fast-deep-equal#readme) | 3.1.3 | MIT |
| [multicast-dns](https://github.com/mafintosh/multicast-dns) | 7.2.5 | MIT |
| [node-addon-api](https://github.com/nodejs/node-addon-api) | 8.9.2 | MIT |
| [node-gyp-build](https://github.com/prebuild/node-gyp-build) | 4.8.4 | MIT |
| [pkijs](https://github.com/PeculiarVentures/PKI.js) | 3.4.1 | BSD-3-Clause |
| [pvtsutils](https://github.com/PeculiarVentures/pvtsutils#readme) | 1.3.6 | MIT |
| [pvutils](https://github.com/PeculiarVentures/pvutils) | 1.2.0 | MIT |
| [reflect-metadata](http://rbuckton.github.io/reflect-metadata) | 0.2.2 | Apache-2.0 |
| [selfsigned](https://github.com/jfromaniello/selfsigned) | 5.5.0 | MIT |
| [thunky](https://github.com/mafintosh/thunky#readme) | 1.1.0 | MIT |
| [tslib](https://www.typescriptlang.org/) | 2.8.1 | 0BSD |
| [tslib](https://www.typescriptlang.org/) | 1.14.1 | 0BSD |
| [tsyringe](https://github.com/Microsoft/tsyringe#readme) | 4.10.0 | MIT |
| [ws](https://github.com/websockets/ws) | 8.22.0 | MIT |

## The fonts

The desktop app, the browser viewer and the Android app use two fonts, both under the [SIL Open Font License 1.1](https://openfontlicense.org), whose full text is in `public/fonts/` and comes with each app:

| Font | Copyright | License |
| --- | --- | --- |
| [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) | 2021 The Pixelify Sans Project Authors | OFL-1.1 (`public/fonts/OFL-PixelifySans.txt`) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | 2020 The JetBrains Mono Project Authors | OFL-1.1 (`public/fonts/OFL-JetBrainsMono.txt`) |

Yes Machine's pixel `ym` logo is drawn from Pixelify Sans' letters.

## The Android app

| Library | Version | Copyright | License |
| --- | --- | --- | --- |
| [OkHttp](https://square.github.io/okhttp/) | 4.11.0 | Square, Inc. | Apache-2.0 |
| [Okio](https://square.github.io/okio/) | 3.2.0 | Square, Inc. | Apache-2.0 |
| [Kotlin standard library](https://kotlinlang.org) | 1.6.20 | JetBrains s.r.o. and the Kotlin contributors | Apache-2.0 |
| [JetBrains Java Annotations](https://github.com/JetBrains/java-annotations) | 13.0 | JetBrains s.r.o. | Apache-2.0 |

OkHttp includes data compiled from [the Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat), under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). The full text of the Apache License 2.0 is at the end of this file.

## Only for building and testing

These tools build, format and test Yes Machine. They aren't part of the apps.

| Tool | License |
| --- | --- |
| [electron-builder](https://www.electron.build) | MIT |
| [Prettier](https://prettier.io) | MIT |
| [prettier-plugin-java](https://github.com/jhipster/prettier-java) | Apache-2.0 |
| [Gradle](https://gradle.org) and the Android Gradle Plugin | Apache-2.0 |
| [JUnit](https://junit.org/junit4/) 4.13.2 | EPL-1.0 |
| [Hamcrest](https://hamcrest.org/JavaHamcrest/) 1.3, which JUnit uses | BSD-3-Clause |

## Apache License 2.0

The software above marked Apache-2.0 is under this license. Its full text:

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
